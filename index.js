const wppconnect = require('@wppconnect-team/wppconnect');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const OLLAMA_MODEL = 'AIClone_colab'; // Your fine-tuned model name
const SYSTEM_PROMPT = "You are a helpful, polite WhatsApp assistant. Always provide concise, relevant answers.";

// Only automate for these contacts (WhatsApp IDs)
const ALLOWED_CONTACTS = [
  '91XXXXXXXXXX@c.us', // Replace with your number format
];

// Path where WPPConnect stores session tokens
const SESSION_PATH = path.join(__dirname, 'tokens');

// Delete old session so QR is required every time
if (fs.existsSync(SESSION_PATH)) {
  fs.rmSync(SESSION_PATH, { recursive: true, force: true });
  console.log("🗑 Old WhatsApp session deleted. QR scan will be required.");
}

// Store the bot start time to filter old messages
const botStartTime = Date.now();

// In-memory conversation history { userId: [ {role, content}, ... ] }
const conversationHistory = {};

wppconnect.create({
  session: 'llamaSession',
  headless: true,
  statusFind: false // Prevent auto status updates
}).then(client => start(client))
  .catch(err => console.error(err));

function start(client) {
  client.onMessage(async (message) => {
    console.log(`📩 Message from ${message.from}: ${message.body}`);

    // Ignore old messages (before bot started)
    if (message.timestamp * 1000 < botStartTime) {
      console.log(`⏩ Ignored old message from ${message.from}`);
      return;
    }

    // Only respond if contact is in whitelist
    if (!message.isGroupMsg && message.type === 'chat' && ALLOWED_CONTACTS.includes(message.from)) {
      const userId = message.from;

      // Initialize history with system prompt if first message from this user
      if (!conversationHistory[userId]) {
        conversationHistory[userId] = [
          { role: "system", content: SYSTEM_PROMPT }
        ];
      }

      // Add user message to history
      conversationHistory[userId].push({ role: "user", content: message.body });

      // Keep only system prompt + last 8 turns (16 messages)
      if (conversationHistory[userId].length > 17) {
        conversationHistory[userId] = [
          conversationHistory[userId][0], // Keep system prompt
          ...conversationHistory[userId].slice(-16)
        ];
      }

      try {
        // Send conversation history to Ollama
        const response = await axios.post(
          'http://localhost:11434/api/chat',
          {
            model: OLLAMA_MODEL,
            messages: conversationHistory[userId],
            stream: false
          },
          { responseType: 'json' }
        );

        const botReply = response.data.message?.content || "No response from model.";

        // Add bot's reply to history
        conversationHistory[userId].push({ role: "assistant", content: botReply });

        // 📜 Debug: Print current conversation for this user
        console.log(`\n===== Conversation with ${userId} =====`);
        console.log(JSON.stringify(conversationHistory[userId], null, 2));
        console.log("=======================================\n");

        // Send reply to WhatsApp
        await client.sendText(userId, botReply.trim());
        console.log(`🤖 Replied to ${userId}`);

      } catch (error) {
        console.error("❌ Error:", error.message);
      }
    } else {
      console.log(`⚠️ Ignored message from ${message.from}`);
    }
  });
}
