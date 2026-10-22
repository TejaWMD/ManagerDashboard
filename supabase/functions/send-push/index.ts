// Supabase Edge Function: send-push
// Sends Desktop Background Push Notifications using Web Push (RFC 8291 / RFC 8292)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.39.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC_KEY =
  Deno.env.get('VAPID_PUBLIC_KEY') ||
  'BCEB9PkPPBOooUYwvmg1UZalOVO10DVdzsdCcKAoHFyARTSRsSjFogXcLzF0KSbLv6Z4IW548ttA0vCBfmMExqI';

const VAPID_PRIVATE_KEY =
  Deno.env.get('VAPID_PRIVATE_KEY') ||
  'EkR8nTNXZQYnYVxi2DIfcVL0tPcXS3ABeSC1ORITpCk';

const VAPID_SUBJECT =
  Deno.env.get('VAPID_SUBJECT') || 'mailto:admin1@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface PushPayload {
  recipientUserIds: string[];
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl =
      Deno.env.get('SUPABASE_URL') ||
      'https://mjrqamakqqsqqmuvaqpw.supabase.co';
    const supabaseServiceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_ANON_KEY') ||
      '';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: PushPayload = await req.json();
    const { recipientUserIds, title, body: msgBody, icon, badge, tag, data } = body;

    if (!recipientUserIds || !Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No recipientUserIds provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Fetch all push subscriptions belonging to the target recipients
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', recipientUserIds);

    if (subError) {
      console.error('[send-push] Failed to query push_subscriptions:', subError.message);
      return new Response(
        JSON.stringify({ error: subError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('[send-push] No active push subscriptions found for recipients:', recipientUserIds);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No push subscriptions found for targets',
          recipientCount: recipientUserIds.length,
          deliveredCount: 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const notificationData = JSON.stringify({
      title: title || 'WMD Query Portal',
      body: msgBody || '',
      icon: icon || './portal-icon.svg',
      badge: badge || './portal-icon.svg',
      tag: tag || ('wmd-alert-' + Date.now()),
      data: data || {},
    });

    let deliveredCount = 0;
    const expiredSubscriptionIds: number[] = [];

    // 3. Dispatch web-push notification to each subscription endpoint
    const sendPromises = subscriptions.map(async (sub) => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushConfig, notificationData, {
          TTL: 86400, // 24 hours
          urgency: 'high',
        });
        deliveredCount++;
      } catch (err: unknown) {
        const errorStatusCode = (err as { statusCode?: number })?.statusCode;
        console.warn(`[send-push] Error sending to user ${sub.user_id}:`, errorStatusCode || err);
        // Clean up 404/410 Gone expired push tokens
        if (errorStatusCode === 404 || errorStatusCode === 410) {
          expiredSubscriptionIds.push(sub.id);
        }
      }
    });

    await Promise.all(sendPromises);

    // 4. Remove expired subscriptions from DB
    if (expiredSubscriptionIds.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', expiredSubscriptionIds);
      console.log(`[send-push] Removed ${expiredSubscriptionIds.length} expired subscriptions`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        deliveredCount,
        recipientsTargeted: recipientUserIds.length,
        subscriptionsCount: subscriptions.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[send-push] Internal error:', errorMsg);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
