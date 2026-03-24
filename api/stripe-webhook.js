import Stripe from 'stripe';
import crypto from 'crypto';
import { buffer } from 'micro';

export const config = {
    api: { bodyParser: false }
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const sig = req.headers['stripe-signature'];
    const rawBody = await buffer(req);
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            rawBody,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_details?.email;
        const amount = session.amount_total / 100;
        const currency = session.currency.toUpperCase();

        if (email) {
            const hashedEmail = crypto
                .createHash('sha256')
                .update(email.toLowerCase().trim())
                .digest('hex');

            const eventId = crypto.randomUUID();

            try {
                const fbRes = await fetch(
                    `https://graph.facebook.com/v19.0/${process.env.FACEBOOK_PIXEL_ID}/events?access_token=${process.env.FACEBOOK_ACCESS_TOKEN}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            data: [{
                                event_name: 'Purchase',
                                event_time: Math.floor(Date.now() / 1000),
                                event_id: eventId,
                                action_source: 'website',
                                user_data: { em: [hashedEmail] },
                                custom_data: {
                                    value: amount,
                                    currency: currency,
                                    content_name: 'pro_subscription'
                                }
                            }]
                        })
                    }
                );
                const fbData = await fbRes.json();
                console.log('Facebook Purchase CAPI fired:', fbData);
            } catch (fbErr) {
                console.error('Facebook CAPI error:', fbErr);
            }
        }
    }

    res.status(200).json({ received: true });
}
