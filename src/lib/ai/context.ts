
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

/**
 * Build AI conversation context.
 *
 * If sessionStartedAt is provided, only messages belonging
 * to the current ordering session will be included.
 *
 * Older WhatsApp messages remain stored in the database.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
  sessionStartedAt?: string,
): Promise<ChatMessage[]> {
  let query = db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')

  // Exclude messages from previous ordering sessions.
  if (sessionStartedAt) {
    query = query.gte('created_at', sessionStartedAt)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()

  return rows
    .filter((message) =>
      Boolean(message.content_text?.trim()),
    )
    .map((message) => ({
      role:
        message.sender_type === 'customer'
          ? 'user'
          : 'assistant',
      content: message.content_text!.trim(),
    }))
}
