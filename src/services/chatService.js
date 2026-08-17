const crypto = require('node:crypto');
const prisma = require('../utils/prismaClient');
const { askAI, deleteSession, isSessionLikelyExpired, submitFeedback } = require('./aiService');
const subscriptionService = require('./subscriptionService');

// Perspectives an answer can be written from. Mirrors the RAG's category enum.
const VALID_PERSPECTIVES = ['Government', 'NGOs', 'Agribusinesses', 'Farmers'];

// How many prior turns to replay when the RAG's session memory has expired.
const HISTORY_LIMIT = 20;

// Debug switch: ask the RAG for retrieval/decomposition counts and log them.
const INCLUDE_TRACE = process.env.AI_INCLUDE_TRACE === '1';

// How long an artifact's signed download URL stays valid. Signed GCS/S3 URLs
// cannot be issued for longer than 7 days, and we cannot refresh them, so this
// is the ceiling. Lower it to match if the data team signs for less.
const ARTIFACT_URL_TTL_MS =
  Number(process.env.AI_ARTIFACT_URL_TTL_SECONDS ?? 604800) * 1000;

exports.VALID_PERSPECTIVES = VALID_PERSPECTIVES;

const logTrace = (chatId, trace) => {
  if (trace) {
    console.log(`RAG trace for chat ${chatId}:`, JSON.stringify(trace));
  }
};

/**
 * Decide how to carry conversation context into the next RAG call.
 *
 * The RAG's own session memory is preferred: it summarises the whole
 * conversation server-side, so we send less and it remembers more. But once a
 * chat has been quiet longer than the session TTL that memory is gone, and
 * because the RAG stops updating a session the moment chat_history is sent, it
 * can never be refilled. So a chat that goes cold once stays on replayed
 * history from then on.
 *
 * @param {object|null} lastAssistantMessage - Latest assistant reply, or null
 * @returns {'session'|'history'} Which mode the next call should use
 */
const resolveMemoryMode = (lastAssistantMessage) => {
  // Chats that predate this field never had a live server session.
  if (lastAssistantMessage?.metadata?.memoryMode !== 'session') {
    return 'history';
  }

  return isSessionLikelyExpired(lastAssistantMessage.createdAt) ? 'history' : 'session';
};

/**
 * Everything worth keeping from a RAG answer, stored on the assistant message.
 *
 * @param {object} aiResponse - Result of askAI
 * @param {'session'|'history'} memoryMode - Mode that produced this turn
 */
const buildAssistantMetadata = (aiResponse, memoryMode) => ({
  citations: aiResponse.citations,
  // Confidence band/score/explanation for this answer.
  acf: aiResponse.acf,
  artifacts: aiResponse.artifacts,
  // Artifact download URLs are signed and expire, so record when we got them.
  artifactsFetchedAt: aiResponse.artifacts.length > 0 ? new Date().toISOString() : null,
  // Needed to attach thumbs up/down feedback to this answer later.
  langfuseTraceId: aiResponse.langfuseTraceId,
  // Drives the next turn's memory decision - see resolveMemoryMode.
  memoryMode
});

/**
 * Strip internals from a message before it leaves over a public share link.
 *
 * A shared chat is readable by anyone holding the token, so the evidence behind
 * an answer stays (citations, confidence) but everything operational goes:
 * artifact downloads are a paid-plan feature whose signed URLs would bypass our
 * access control, and the Langfuse trace id would let a stranger file feedback
 * against someone else's conversation.
 *
 * @param {object} message - Message record
 * @returns {object} Message safe to expose publicly
 */
const toPublicMessage = (message) => ({
  id: message.id,
  role: message.role,
  content: message.content,
  category: message.category,
  createdAt: message.createdAt,
  metadata: message.metadata
    ? {
        citations: message.metadata.citations ?? [],
        acf: message.metadata.acf ?? null
      }
    : null
});

/**
 * The RAG echoes back the session id we send. If it ever returns a different
 * one, our chat id is no longer the session key and continuity is silently
 * broken, so make that visible rather than letting answers lose context.
 */
const warnOnSessionMismatch = (chatId, aiResponse, memoryMode) => {
  if (memoryMode === 'session' && aiResponse.sessionId && aiResponse.sessionId !== chatId) {
    console.warn(
      `RAG returned session ${aiResponse.sessionId} for chat ${chatId}; conversation memory may not persist.`
    );
  }
};

/**
 * Get all chats for a user
 * @param {string} userId - User's ID
 * @param {boolean} includeArchived - Include archived chats (defaults to true)
 * @returns {array} Array of chats
 */
exports.getUserChats = async (userId, includeArchived = true) => {
  // Build where clause
  const where = { userId };
  if (!includeArchived) {
    where.archived = false; // Only non-archived chats
  }

  // Fetch all chats for the user, ordered by most recent first
  const chats = await prisma.chat.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      category: true,
      archived: true,
      createdAt: true
    }
  });

  return chats;
};

/**
 * Get specific chat with all messages
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Chat with messages
 */
exports.getChatWithMessages = async (chatId, userId) => {
  // Fetch chat with all messages, ensuring it belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Ensures user can only access their own chats
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' } // Oldest messages first
      }
    }
  });

  return chat;
};

/**
 * Send a message in a chat and get AI response
 * @param {string} userId - User's ID
 * @param {string} message - User's message
 * @param {string|undefined} perspective - Optional perspective for Free and Integrated users (Government, NGOs, Agribusinesses, Farmers)
 * @returns {object} Chat with messages
 */
exports.sendMessage = async (userId, message, perspective = null) => {
  // Check if subscription is active
  const isActive = await subscriptionService.isSubscriptionActive(userId);
  if (!isActive) {
    throw new Error('Subscription not active. Please complete payment to access chat.');
  }

  // Get user's subscription to determine category
  const subscription = await subscriptionService.getCurrentSubscription(userId);
  if (!subscription) {
    throw new Error('No subscription found. Please select a plan first.');
  }

  // Determine category based on subscription plan
  let category = subscription.planType;

  // For Free and Integrated users, allow optional perspective parameter or default to Government
  if (subscription.planType === 'Free' || subscription.planType === 'Integrated') {
    const selectedPerspective = perspective || 'Government'; // Default to Government if not specified

    if (!VALID_PERSPECTIVES.includes(selectedPerspective)) {
      throw new Error(`Invalid perspective: ${selectedPerspective}`);
    }
    category = selectedPerspective;
  }

  // Load the user's country for the RAG user profile (set once at registration)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { country: true }
  });

  // Create the chat first so its id can be reused as the RAG session id
  const chat = await prisma.chat.create({
    data: {
      userId,
      title: message.substring(0, 50), // Use first 50 characters as title
      category // Auto-set from subscription
    }
  });

  // Profile the RAG service uses for plan/country-based access control
  const userProfile = {
    country: user?.country ?? null,
    plan_type: subscription.planType,
    category
  };

  // Get AI response. A new chat has no prior turns, so this opens a server-side
  // session keyed on the chat id. If the call fails, roll back the empty chat we
  // just created so it does not linger as an orphan.
  let aiResponse;
  try {
    aiResponse = await askAI({
      query: message,
      planType: subscription.planType,
      userProfile,
      sessionId: chat.id,
      userId,
      includeTrace: INCLUDE_TRACE
    });
  } catch (error) {
    await prisma.chat.delete({ where: { id: chat.id } }).catch(() => {});
    throw error;
  }

  logTrace(chat.id, aiResponse.trace);
  warnOnSessionMismatch(chat.id, aiResponse, 'session');

  // Create user's message
  const userMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: 'user',
      content: message,
      category: category  // Track which perspective/category this message used
    }
  });

  // Create AI's response message (store citations from the RAG service in metadata)
  const assistantMessage = await prisma.message.create({
    data: {
      chatId: chat.id,
      role: 'assistant',
      content: aiResponse.answer,
      category: category,  // Track which perspective/category this response used
      metadata: buildAssistantMetadata(aiResponse, 'session')
    }
  });

  // Return chat with messages
  return {
    id: chat.id,
    title: chat.title,
    category: chat.category,
    userId: chat.userId,
    createdAt: chat.createdAt,
    messages: [userMessage, assistantMessage],
    tokenUsage: aiResponse.usage
  };
};

/**
 * Add message to existing chat and get AI response
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @param {string} message - User's message
 * @param {string|undefined} perspective - Optional perspective for Free and Integrated users
 * @returns {object} Updated chat with all messages
 */
exports.addMessageToExistingChat = async (chatId, userId, message, perspective = null) => {
  // Check if subscription is active
  const isActive = await subscriptionService.isSubscriptionActive(userId);
  if (!isActive) {
    throw new Error('Subscription not active. Please complete payment to access chat.');
  }

  // First, verify the chat exists and belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Security: ensures user owns the chat
    }
  });

  if (!chat) {
    return null; // Chat not found or unauthorized
  }

  // Get subscription to check plan type. The RAG requires a valid plan_type on
  // every request, and it selects which endpoint we call, so a missing
  // subscription has to fail here rather than upstream.
  const subscription = await subscriptionService.getCurrentSubscription(userId);
  if (!subscription) {
    throw new Error('No subscription found. Please select a plan first.');
  }

  // For Free and Integrated users, allow perspective override; otherwise keep the chat's existing category
  let responseCategory = chat.category;
  if (subscription.planType === 'Free' || subscription.planType === 'Integrated') {
    if (perspective) {
      if (!VALID_PERSPECTIVES.includes(perspective)) {
        throw new Error(`Invalid perspective: ${perspective}`);
      }

      responseCategory = perspective;
    } else {
      const lastMessageWithCategory = await prisma.message.findFirst({
        where: {
          chatId,
          category: { not: null }
        },
        orderBy: { createdAt: 'desc' },
        select: { category: true }
      });

      if (lastMessageWithCategory?.category) {
        responseCategory = lastMessageWithCategory.category;
      }
    }
  }

  // Load the user's country for the RAG user profile
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { country: true }
  });

  // Work out whether the RAG still holds this conversation, or whether we have
  // to replay it ourselves. Based on the last answer, since that is when the
  // server-side session was last touched.
  const lastAssistantMessage = await prisma.message.findFirst({
    where: { chatId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, metadata: true }
  });
  const memoryMode = resolveMemoryMode(lastAssistantMessage);

  // Only build history when the session is gone; otherwise the RAG has better
  // context than we could send, and sending history would stop it updating.
  // Fetched before the new message is saved, so it holds only earlier turns,
  // and capped so the payload cannot grow past the model's context window.
  let chatHistory = null;
  if (memoryMode === 'history') {
    const priorMessages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' }, // newest first, so `take` keeps the most recent
      take: HISTORY_LIMIT,
      select: { role: true, content: true }
    });
    priorMessages.reverse(); // back to chronological order (oldest -> newest) for the RAG
    chatHistory = priorMessages.map((m) => ({ role: m.role, content: m.content }));
  }

  // Profile the RAG service uses for plan/country-based access control
  const userProfile = {
    country: user?.country ?? null,
    plan_type: subscription.planType,
    category: responseCategory
  };

  // Get AI response, carrying context whichever way is still available.
  const aiResponse = await askAI({
    query: message,
    planType: subscription.planType,
    userProfile,
    sessionId: memoryMode === 'session' ? chatId : null,
    chatHistory,
    userId,
    includeTrace: INCLUDE_TRACE
  });

  logTrace(chatId, aiResponse.trace);
  warnOnSessionMismatch(chatId, aiResponse, memoryMode);

  // Create user's message
  const userMessage = await prisma.message.create({
    data: {
      chatId,
      role: 'user',
      content: message,
      category: responseCategory  // Track which perspective/category this message used
    }
  });

  // Create AI's response message (store citations from the RAG service in metadata)
  const assistantMessage = await prisma.message.create({
    data: {
      chatId,
      role: 'assistant',
      content: aiResponse.answer,
      category: responseCategory,  // Track which perspective/category this response used
      metadata: buildAssistantMetadata(aiResponse, memoryMode)
    }
  });

  // Return chat with all messages
  const updatedChat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  return {
    ...updatedChat,
    tokenUsage: aiResponse.usage
  };
};

/**
 * Record a user's thumbs up/down on an AI answer.
 *
 * Sends the rating to the RAG against that answer's Langfuse trace, and stores
 * it on the message so reopening the chat shows what the user already voted.
 *
 * @param {string} messageId - Assistant message being rated
 * @param {string} userId - User's ID (for authorization)
 * @param {number} score - 1 for thumbs up, 0 for thumbs down
 * @param {string|null} [comment] - Optional note
 * @returns {object|null} The stored feedback, or null if not found/unauthorized
 */
exports.submitMessageFeedback = async (messageId, userId, score, comment = null) => {
  // Match on the owning chat's user so one person cannot rate another's answers
  const message = await prisma.message.findFirst({
    where: { id: messageId, chat: { userId } },
    select: { id: true, role: true, metadata: true }
  });

  if (!message) {
    return null; // Message not found, or it belongs to someone else
  }

  if (message.role !== 'assistant') {
    throw new Error('Feedback can only be given on AI answers');
  }

  // Answers from before we stored trace ids cannot be rated: the RAG identifies
  // feedback by trace, and we have no other handle on that answer.
  const traceId = message.metadata?.langfuseTraceId;
  if (!traceId) {
    throw new Error('This answer cannot be rated');
  }

  // Send upstream first: if the RAG rejects it, nothing is recorded our side
  await submitFeedback({ traceId, score, comment });

  const feedback = { score, comment, submittedAt: new Date().toISOString() };
  await prisma.message.update({
    where: { id: messageId },
    data: { metadata: { ...message.metadata, feedback } }
  });

  return feedback;
};

/**
 * Look up a downloadable export attached to an AI answer.
 *
 * Reports expiry rather than hiding it, so the caller can tell the user their
 * download has lapsed instead of sending them to a dead storage link.
 *
 * @param {string} messageId - Message the export belongs to
 * @param {string} artifactId - Artifact id from the answer's metadata
 * @param {string} userId - User's ID (for authorization)
 * @returns {{artifact: object, expired: boolean}|null} Null if not found/unauthorized
 */
exports.getMessageArtifact = async (messageId, artifactId, userId) => {
  // Match through the owning chat so exports stay private to their owner
  const message = await prisma.message.findFirst({
    where: { id: messageId, chat: { userId } },
    select: { metadata: true }
  });

  if (!message) {
    return null; // Message not found, or it belongs to someone else
  }

  const artifact = (message.metadata?.artifacts ?? []).find((item) => item.id === artifactId);
  if (!artifact) {
    return null;
  }

  // We cannot ask the storage provider whether a signed URL is still good - the
  // signature covers the HTTP method, so probing it would fail even when valid.
  // Judge from when we received it instead.
  const fetchedAt = message.metadata?.artifactsFetchedAt;
  const expired =
    !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > ARTIFACT_URL_TTL_MS;

  return { artifact, expired };
};

/**
 * Archive a chat (hides chat without deleting)
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Archived chat
 */
exports.archiveChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Archive the chat
  const archivedChat = await prisma.chat.update({
    where: { id: chatId },
    data: { archived: true }
  });

  return archivedChat;
};

/**
 * Unarchive a chat
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Unarchived chat
 */
exports.unarchiveChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Unarchive the chat
  const unarchivedChat = await prisma.chat.update({
    where: { id: chatId },
    data: { archived: false }
  });

  return unarchivedChat;
};

/**
 * Share a chat with a unique token
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Shared chat with shareToken
 */
exports.shareChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Generate unique share token (using chatId + random string)
  const shareToken = `${chatId.substring(0, 8)}-${crypto.randomBytes(8).toString('hex')}`

  // Share the chat
  const sharedChat = await prisma.chat.update({
    where: { id: chatId },
    data: {
      isShared: true,
      shareToken
    }
  });

  return sharedChat;
};

/**
 * Unshare a chat (revoke public access)
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {object} Unshared chat
 */
exports.unshareChat = async (chatId, userId) => {
  // Verify ownership
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId }
  });

  if (!chat) {
    throw new Error('Chat not found or unauthorized');
  }

  // Unshare the chat
  const unsharedChat = await prisma.chat.update({
    where: { id: chatId },
    data: {
      isShared: false,
      shareToken: null
    }
  });

  return unsharedChat;
};

/**
 * Get a shared chat by token (public access - no authentication required)
 * @param {string} shareToken - Share token
 * @returns {object} Chat with messages (read-only view)
 */
exports.getSharedChat = async (shareToken) => {
  // Fetch chat by shareToken
  const chat = await prisma.chat.findUnique({
    where: { shareToken },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!chat?.isShared) {
    throw new Error('Shared chat not found or no longer shared');
  }

  // Return chat without sensitive data (userId not included in response, and
  // message internals stripped - see toPublicMessage)
  return {
    id: chat.id,
    title: chat.title,
    category: chat.category,
    createdAt: chat.createdAt,
    messages: chat.messages.map(toPublicMessage)
  };
};

/**
 * Delete a chat and all its messages
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @returns {boolean} True if deleted, false if not found/unauthorized
 */
exports.deleteChat = async (chatId, userId) => {
  // Verify the chat exists and belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Security: ensures user owns the chat
    }
  });

  if (!chat) {
    return false; // Chat not found or unauthorized
  }

  // Delete the chat (messages will cascade delete automatically)
  await prisma.chat.delete({
    where: { id: chatId }
  });

  // Drop the conversation from the RAG's memory too. Fire-and-forget: the chat
  // is already gone on our side, so a slow or failing upstream cleanup must not
  // hold up the response or make the delete look like it failed.
  deleteSession(chatId).catch(() => {});

  return true;
};

/**
 * Update chat title
 * @param {string} chatId - Chat's ID
 * @param {string} userId - User's ID (for authorization)
 * @param {string} newTitle - New title for the chat
 * @returns {object|null} Updated chat or null if not found/unauthorized
 */
exports.updateChatTitle = async (chatId, userId, newTitle) => {
  // Verify the chat exists and belongs to the user
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId // Security: ensure user owns the chat
    }
  });

  if (!chat) {
    return null; // Chat not found or unauthorized
  }

  // Update the chat title
  const updatedChat = await prisma.chat.update({
    where: { id: chatId },
    data: { title: newTitle },
    select: {
      id: true,
      title: true,
      category: true,
      createdAt: true,
      updatedAt: true
    }
  });

  return updatedChat;
};
