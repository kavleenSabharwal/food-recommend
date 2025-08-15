# 🍽 Food Recommendation WhatsApp Bot

A Firebase Cloud Functions-based WhatsApp bot that suggests daily meal ideas (breakfast, lunch, dinner), logs user preferences, and answers recipe-related queries using AI (Gemini API).  
Built to make meal planning easier while learning conversational AI and WhatsApp Cloud API integration.

---

## 🚀 Features
- **Daily Meal Suggestions**  
  Automatically sends breakfast, lunch, and dinner ideas via WhatsApp using scheduled cron jobs.
- **Personalized Recommendations**  
  Logs user responses in Firestore to improve future meal suggestions.
- **Recipe Queries**  
  Users can ask for recipes, and the bot responds with AI-generated step-by-step instructions.
- **Meal Logging**  
  Classifies meals based on reply time (IST) or explicit meal type mention.
- **Onboarding Flow**  
  Asks dietary preference questions and stores them in Firestore for personalized suggestions.
- **Contextual Conversations**  
  Maintains last 5 messages for each user so chats feel natural and continuous.

---

## 🛠 Tech Stack
- **Backend:** [Firebase Cloud Functions](https://firebase.google.com/docs/functions)
- **Database:** [Cloud Firestore](https://firebase.google.com/docs/firestore)
- **Messaging:** [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp)
- **AI Responses:** [Google Gemini API](https://deepmind.google/technologies/gemini)
- **Language:** JavaScript (Node.js)
- **Logging:** Custom logger for structured console output

---

## 📂 Project Structure
functions/
├── cron/ # Scheduled tasks (send meals, onboarding)
├── handlers/ # Incoming message handling
├── services/ # AI & WhatsApp API logic
├── utils/ # Helper utilities (Firestore, time, logging)
├── constants.js # Constant values
├── config.js # Configuration settings



---

## ⚙️ Setup & Installation

### 1️⃣ Clone the repository 
``bash
git clone https://github.com/kavleenSabharwal/food-recommend.git
cd food-recommend/functions``

2️⃣ Install dependencies
npm install

3️⃣ Setup environment variables

Create a .env file in the functions/ folder:

``WHATSAPP_API_URL=<your-whatsapp-api-url>
WHATSAPP_TOKEN=<your-whatsapp-access-token>
GEMINI_API_KEY=<your-gemini-api-key>``

4️⃣ Firebase project setup

Install Firebase CLI:
``npm install -g firebase-tools
Login:
firebase login
Select your project:
firebase use <your-firebase-project-id>``

5️⃣ Deploy
firebase deploy --only functions

📆 Cron Jobs

Breakfast: Sends at 8 AM IST
Lunch: Sends at 12 PM IST
Dinner: Sends at 7 PM IST

🧠 AI Logic

Calls Gemini API to:
Suggest meals based on preferences
Answer cooking/recipe queries
Logs every user interaction in Firestore for future recommendations.

## 🖼 Example Flow

Here’s how the WhatsApp bot interacts with users:

![WhatsApp Conversation Screenshot](https://github.com/user-attachments/assets/a5f8c111-4548-4bc7-b495-1cd045ef570d)
![IMG_E1E5122D07BD-1](https://github.com/user-attachments/assets/f8041ddf-0de9-4cc0-b1e0-769cdd71d6dd)

📌 To-Do / Future Enhancements

Add image-based meal suggestions
Support multi-language replies
Improve AI personalization with more data points
Vacation food planning

🤝 Contributing

Pull requests are welcome. Please open an issue first to discuss what you’d like to change.

💬 Contact

Created by Kavleen Sabharwal
If you use this project, tag me! I'd love to see it in action.
