-- ============================================================
-- WACRM: CUSTOMER FEEDBACK AUTOMATION WORKFLOW TEMPLATE
-- Migration: 202611220004_customer_feedback_workflow_template.sql
--
-- Configures the production-ready 5-node pipeline for Customer Feedback Automation:
-- Order Completed -> Eligibility Check -> 20-Minute Delay -> Pre-Send Revalidation -> WhatsApp Feedback
--
-- Safety Guarantees:
-- 1. Does not hardcode a single tenant-specific workflow ID; targets by canonical slug 'customer-feedback-automation'.
-- 2. Preserves status as 'draft' (never auto-publishes).
-- 3. Preserves existing versions and execution history.
-- ============================================================

DO $$
DECLARE
  v_workflow_def JSONB;
BEGIN
  v_workflow_def := jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object(
        'id', 'trigger_order_completed',
        'type', 'trigger',
        'position', jsonb_build_object('x', 0, 'y', 0),
        'data', jsonb_build_object(
          'label', 'Order Completed Trigger',
          'subType', 'order_event',
          'event', 'order.completed',
          'description', 'Triggered when a restaurant order is fulfilled, served, or delivered.'
        )
      ),
      jsonb_build_object(
        'id', 'action_eligibility_check',
        'type', 'action',
        'position', jsonb_build_object('x', 0, 'y', 160),
        'data', jsonb_build_object(
          'label', 'Validate Feedback Eligibility',
          'subType', 'restaurant_feedback_eligibility',
          'description', 'Validates order completion, customer consent (no opt-out/DND), staff exclusion, and ledger idempotency.'
        )
      ),
      jsonb_build_object(
        'id', 'action_feedback_delay',
        'type', 'action',
        'position', jsonb_build_object('x', 0, 'y', 320),
        'data', jsonb_build_object(
          'label', '20-Minute Delay Timer',
          'subType', 'delay',
          'delayMinutes', 20,
          'description', 'Durable persistent wait of 20 minutes allowing the customer to enjoy their meal before receiving feedback inquiry.'
        )
      ),
      jsonb_build_object(
        'id', 'action_presend_revalidation',
        'type', 'action',
        'position', jsonb_build_object('x', 0, 'y', 480),
        'data', jsonb_build_object(
          'label', 'Pre-Send Revalidation',
          'subType', 'restaurant_feedback_revalidation',
          'description', 'Re-verifies order status, customer consent, duplicate prevention, and WhatsApp 24-hour service window vs template requirements.'
        )
      ),
      jsonb_build_object(
        'id', 'action_whatsapp_feedback',
        'type', 'action',
        'position', jsonb_build_object('x', 0, 'y', 640),
        'data', jsonb_build_object(
          'label', 'Customer Feedback Request',
          'subType', 'whatsapp_message',
          'messageMode', 'template',
          'templateName', 'customer_feedback',
          'templateLanguage', 'en',
          'templateParams', jsonb_build_array('{{customerName}}', '{{orderNumber}}'),
          'messageTemplate', 'The Illusion Cafe & Restaurant ki taraf se shukriya! ❤️\n\nAapka order #{{orderNumber}} complete ho gaya hai. Hum umeed karte hain ki aapko hamari service pasand aayi hogi.\n\nJab aap apna food enjoy kar lein, toh please humein batayein ki aapka experience kaisa raha:\n\n⭐ 1 - Excellent\n👍 2 - Good\n🙂 3 - Average\n\nAap apna rating reply karke de sakte hain. Thank you for choosing us! 🍽️',
          'description', 'Sends feedback request using pre-approved template or freeform text within customer service window.'
        )
      )
    ),
    'edges', jsonb_build_array(
      jsonb_build_object(
        'id', 'e-trigger-to-eligibility',
        'source', 'trigger_order_completed',
        'target', 'action_eligibility_check'
      ),
      jsonb_build_object(
        'id', 'e-eligibility-to-delay',
        'source', 'action_eligibility_check',
        'target', 'action_feedback_delay'
      ),
      jsonb_build_object(
        'id', 'e-delay-to-revalidation',
        'source', 'action_feedback_delay',
        'target', 'action_presend_revalidation'
      ),
      jsonb_build_object(
        'id', 'e-revalidation-to-whatsapp',
        'source', 'action_presend_revalidation',
        'target', 'action_whatsapp_feedback'
      )
    )
  );

  -- Update existing workflow definition matching slug 'customer-feedback-automation'
  -- Preserves status as 'draft'
  UPDATE public.backend_flows
  SET
    definition = v_workflow_def,
    trigger_type = 'order_event',
    trigger_config = jsonb_build_object('event', 'order.completed'),
    status = 'draft',
    updated_at = now()
  WHERE slug = 'customer-feedback-automation';

END $$;
