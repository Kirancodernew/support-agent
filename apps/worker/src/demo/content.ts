/**
 * What "Try the demo" shows: a small online shop's help documents and two weeks of customer chats,
 * so Insights, the Inbox and the conversation list have something real to show. Orders match the
 * demo shop on the web app (1001 and 1002 belong to demo@acme.example).
 */

export const DEMO_WORKSPACE_NAME = 'Acme Home Store (demo)';
// Never emailed (the demo sends no email) and nobody can log in with it: there's no known password.
export const DEMO_USER_EMAIL = 'demo-owner@example.com';

export const DEMO_DOCUMENTS = [
  {
    filename: 'help-center.md',
    text: `# Acme Home Store — Help Center

## Shipping
Standard shipping takes 3 to 5 business days within India and is free on orders above Rs 999.
Below that, standard shipping costs Rs 49. Express delivery arrives the next day in Delhi, Mumbai,
Bengaluru, Hyderabad, Chennai and Kolkata and costs Rs 99. We do not ship outside India yet.

## Tracking an order
You get a tracking link by SMS and email when your order ships. You can also ask our assistant for
your order status with your order number and the email you ordered with.

## Payments
We accept UPI, credit and debit cards, net banking and cash on delivery (up to Rs 5,000).
EMI is available on credit cards for orders above Rs 3,000.

## Store hours and contact
Our stores are open from 10am to 9pm, every day including Sundays. Customer support is available
by chat 24/7 and by phone (1800-123-4567) from 9am to 8pm, Monday to Saturday.
`,
  },
  {
    filename: 'returns-policy.md',
    text: `# Returns and refunds

## Returning an item
You can return any item within 30 days of delivery for a full refund, as long as it is unused and in
its original packaging. Start a return from your order page, and we pick it up from your address free
of charge.

## Refund timing
Refunds are issued to the original payment method within 2 days of pickup. Banks usually take 5 to 7
business days to show the money. Cash on delivery orders are refunded by bank transfer.

## Damaged or wrong items
If an item arrives damaged or you received the wrong item, tell us within 48 hours with a photo. We
send a replacement at no cost, or a full refund if it is out of stock.

## Items that can't be returned
Personalised items, opened candles and gift cards cannot be returned.
`,
  },
] as const;

export type DemoTurn = {
  q: string;
  a: string;
  /** Which documents the answer cites, by index in DEMO_DOCUMENTS, in [1], [2] order. */
  cites?: number[];
  unanswered?: boolean;
  feedback?: 'up' | 'down';
  ms: number;
  actions?: { tool: string; ok: boolean }[];
};

export type DemoChat = {
  hoursAgo: number;
  channel: 'widget' | 'dashboard';
  needsHuman?: boolean;
  turns: DemoTurn[];
  inbox?: {
    kind: 'ticket' | 'callback' | 'handoff';
    summary: string;
    details?: string;
    customerEmail?: string;
    customerPhone?: string;
    preferredTime?: string;
    status?: 'open' | 'closed';
  };
};

const SORRY = "I'm sorry, I don't have information about that. I can raise a ticket or connect you with our team if you like.";

export const DEMO_CHATS: DemoChat[] = [
  { hoursAgo: 2, channel: 'widget', turns: [{ q: 'How long does delivery take to Pune?', a: 'Standard shipping takes 3 to 5 business days within India, and it is free on orders above Rs 999 [1]. Express next-day delivery is only available in six metro cities, which do not include Pune [1].', cites: [0], feedback: 'up', ms: 820 }] },
  { hoursAgo: 5, channel: 'widget', turns: [{ q: 'Do you have a student discount?', a: SORRY, unanswered: true, ms: 760, actions: [{ tool: 'flag_unanswered', ok: true }] }] },
  {
    hoursAgo: 9,
    channel: 'widget',
    turns: [
      { q: 'Where is my order 1001?', a: 'I can check that for you. What email address did you order with?', ms: 690 },
      { q: 'demo@acme.example', a: 'Your order 1001 (Ceramic mug x2) has shipped and arrives on 21 Oct.', ms: 1640, actions: [{ tool: 'get_order_status', ok: true }], feedback: 'up' },
    ],
  },
  { hoursAgo: 20, channel: 'widget', turns: [{ q: 'Can I pay with UPI?', a: 'Yes. We accept UPI, credit and debit cards, net banking and cash on delivery up to Rs 5,000 [1].', cites: [0], feedback: 'up', ms: 710 }] },
  {
    hoursAgo: 26,
    channel: 'widget',
    turns: [
      { q: 'My lamp arrived broken', a: "I'm sorry about that. Damaged items reported within 48 hours with a photo get a free replacement, or a full refund if it's out of stock [1]. Shall I raise a ticket for our team? I'll need your email.", cites: [1], ms: 900 },
      { q: 'yes please, priya@acme.example, order 1003', a: "Just to confirm: I'll raise a ticket \"Brass lamp arrived broken (order 1003)\" for priya@acme.example. Shall I go ahead?", ms: 1210 },
      { q: 'yes', a: 'Done. Your ticket number is T-0004. Our team will email you within one business day.', ms: 1380, actions: [{ tool: 'create_ticket', ok: true }], feedback: 'up' },
    ],
    inbox: { kind: 'ticket', summary: 'Brass lamp arrived broken (order 1003)', details: 'Customer reports the lamp arrived damaged. Asked for a replacement.', customerEmail: 'priya@acme.example' },
  },
  { hoursAgo: 31, channel: 'widget', turns: [{ q: 'do you have a student discount', a: SORRY, unanswered: true, feedback: 'down', ms: 740, actions: [{ tool: 'flag_unanswered', ok: true }] }] },
  { hoursAgo: 40, channel: 'widget', turns: [{ q: 'How long do refunds take?', a: 'Refunds go to your original payment method within 2 days of pickup, and banks usually take 5 to 7 business days to show the money [1].', cites: [1], feedback: 'up', ms: 780 }] },
  { hoursAgo: 52, channel: 'widget', turns: [{ q: 'Do you ship to Dubai?', a: "We don't ship outside India yet [1].", cites: [0], ms: 650 }] },
  { hoursAgo: 60, channel: 'dashboard', turns: [{ q: 'What are your store hours on Sunday?', a: 'Our stores are open from 10am to 9pm every day, including Sundays [1].', cites: [0], ms: 600 }] },
  { hoursAgo: 71, channel: 'widget', turns: [{ q: 'Can you gift wrap my order?', a: SORRY, unanswered: true, ms: 800, actions: [{ tool: 'flag_unanswered', ok: true }] }] },
  {
    hoursAgo: 80,
    channel: 'widget',
    needsHuman: true,
    turns: [
      { q: 'I was charged twice for the same order', a: "I'm sorry about that. I'll connect you with a person from our team who can look into the payment.", ms: 1150, actions: [{ tool: 'handoff_to_human', ok: true }] },
    ],
    inbox: { kind: 'handoff', summary: 'Customer charged twice for one order', details: 'Wants the duplicate payment reversed.' },
  },
  { hoursAgo: 96, channel: 'widget', turns: [{ q: 'Can I return a candle I opened?', a: "Opened candles can't be returned, along with personalised items and gift cards [1].", cites: [1], feedback: 'down', ms: 720 }] },
  { hoursAgo: 110, channel: 'widget', turns: [{ q: 'Do you offer EMI?', a: 'Yes, EMI is available on credit cards for orders above Rs 3,000 [1].', cites: [0], feedback: 'up', ms: 690 }] },
  {
    hoursAgo: 130,
    channel: 'widget',
    turns: [
      { q: 'Can someone call me about a bulk order for my office?', a: 'Sure. What phone number should we call, and when suits you?', ms: 760 },
      { q: '9876543210, tomorrow after 3pm', a: 'To confirm: a call-back to 9876543210 tomorrow after 3pm about a bulk office order. Shall I book it?', ms: 1020 },
      { q: 'yes', a: 'Booked. Our team will call you tomorrow after 3pm (T-0002).', ms: 1290, actions: [{ tool: 'request_callback', ok: true }], feedback: 'up' },
    ],
    inbox: { kind: 'callback', summary: 'Bulk order for an office', customerPhone: '9876543210', preferredTime: 'Tomorrow after 3pm' },
  },
  { hoursAgo: 150, channel: 'widget', turns: [{ q: 'Do you have a student discount?', a: SORRY, unanswered: true, ms: 770, actions: [{ tool: 'flag_unanswered', ok: true }] }] },
  { hoursAgo: 170, channel: 'widget', turns: [{ q: 'Is cash on delivery available?', a: 'Yes, cash on delivery is available for orders up to Rs 5,000 [1].', cites: [0], ms: 640 }] },
  {
    hoursAgo: 190,
    channel: 'widget',
    turns: [
      { q: "What's the status of order 1002? email demo@acme.example", a: 'Order 1002 (Linen tote bag) is being processed and ships within 2 days.', ms: 1580, actions: [{ tool: 'get_order_status', ok: true }] },
    ],
  },
  { hoursAgo: 215, channel: 'widget', turns: [{ q: 'What warranty do your lamps have?', a: SORRY, unanswered: true, ms: 790, actions: [{ tool: 'flag_unanswered', ok: true }] }] },
  {
    hoursAgo: 240,
    channel: 'widget',
    turns: [
      { q: 'I received the wrong colour of tote bag', a: "Sorry about that! Wrong items reported within 48 hours with a photo get a free replacement [1]. Shall I raise a ticket? What's your email?", cites: [1], ms: 880 },
      { q: 'demo@acme.example. Yes raise it', a: 'To confirm: a ticket "Wrong colour tote bag received" for demo@acme.example. Go ahead?', ms: 1100 },
      { q: 'go ahead', a: 'Done, your ticket is T-0001.', ms: 1240, actions: [{ tool: 'create_ticket', ok: true }] },
    ],
    inbox: { kind: 'ticket', summary: 'Wrong colour tote bag received', customerEmail: 'demo@acme.example', status: 'closed' },
  },
  { hoursAgo: 265, channel: 'widget', turns: [{ q: 'Can you gift-wrap a present?', a: SORRY, unanswered: true, ms: 810, actions: [{ tool: 'flag_unanswered', ok: true }] }] },
  { hoursAgo: 290, channel: 'widget', turns: [{ q: 'How much is express delivery?', a: 'Express delivery costs Rs 99 and arrives the next day in Delhi, Mumbai, Bengaluru, Hyderabad, Chennai and Kolkata [1].', cites: [0], feedback: 'up', ms: 700 }] },
  { hoursAgo: 310, channel: 'widget', turns: [{ q: 'Who won the cricket match yesterday?', a: 'I can only help with questions about Acme Home Store.', ms: 620 }] },
];
