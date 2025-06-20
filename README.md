# Telegram Channel Parser

A Node.js application that monitors multiple public Telegram channels for specific keywords and sends notifications when matches are found.

## Features

- Monitors multiple public Telegram channels every 3 minutes
- Searches for specific keywords in messages (supports multiple keywords)
- Sends a notification with a link to the message when any of the keywords are found, indicating which specific keywords were matched and which channel the message was found in
- Avoids duplicate notifications by tracking the last checked message for each channel

## Prerequisites

- Node.js (v14 or higher recommended)
- npm (comes with Node.js)
- Telegram account
- Telegram API credentials (API ID and API Hash)

## Setup

1. Clone this repository:
   ```
   git clone <repository-url>
   cd tgparser
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the project root:
   - Copy the provided `.env.example` file to create your own `.env` file:
     ```
     cp .env.example .env
     ```
   - Then edit the `.env` file with your actual values:
     ```
     # Telegram API credentials
     # Get these from https://my.telegram.org/apps
     API_ID=your_api_id
     API_HASH=your_api_hash

     # Your phone number in international format
     PHONE_NUMBER=+1234567890

     # Channels to monitor (without the @ symbol, comma-separated for multiple channels)
     CHANNEL_USERNAME=channel_name,another_channel

     # Words to search for (comma-separated for multiple words)
     SEARCH_WORD=target_word,another_word

     # Your Telegram user ID to receive notifications
     USER_ID=your_user_id

     # Session name (can be any string)
     SESSION_NAME=tgparser
     ```
   - The `.env.example` file contains detailed comments and examples to help you fill in each field correctly

4. Get your Telegram API credentials:
   - Go to https://my.telegram.org/apps
   - Log in with your phone number
   - You'll receive a confirmation code via Telegram, enter it on the website
   - Fill out the form with your details (you can use "Telegram Parser" as the app title)
   - In the "App Configuration" section, you'll see your API ID (a number) and API Hash (a long string)
   - Copy these values to your `.env` file:
     ```
     API_ID=123456  # Replace with your actual API ID (numbers only)
     API_HASH=abcdef1234567890abcdef1234567890  # Replace with your actual API Hash
     ```
   - Keep these credentials secure and never share them publicly

   Visual guide to obtaining API credentials:
   ```
   ┌─────────────────────────────────────────────────────┐
   │                                                     │
   │  1. Visit https://my.telegram.org/apps              │
   │     │                                               │
   │     ▼                                               │
   │  2. Log in with your phone number                   │
   │     │                                               │
   │     ▼                                               │
   │  3. Enter confirmation code sent to your Telegram   │
   │     │                                               │
   │     ▼                                               │
   │  4. Fill out the form (App title, Short name, etc.) │
   │     │                                               │
   │     ▼                                               │
   │  5. Submit the form                                 │
   │     │                                               │
   │     ▼                                               │
   │  6. View your API ID and API Hash                   │
   │     │                                               │
   │     ▼                                               │
   │  7. Copy values to your .env file                   │
   │                                                     │
   └─────────────────────────────────────────────────────┘
   ```

5. Find your Telegram user ID:
   - You can use the @userinfobot on Telegram to get your user ID
   - Send a message to this bot, and it will reply with your user ID
   - Copy this ID to the `USER_ID` field in your `.env` file

## Usage

Run the application:

```
npm start
```

On the first run, you'll be prompted to enter:
1. The verification code sent to your Telegram account
2. Your 2FA password (if enabled)

After successful authentication, the application will:
1. Start monitoring all the specified channels
2. Check for new messages every 4 minutes
3. Send you a notification when it finds a message containing any of your target words, including which channel it was found in

## How It Works

1. The application uses the Telegram API to connect to your account
2. It periodically fetches the latest messages from each of the specified channels
3. It searches these messages for any of the keywords specified in your `.env` file
4. When a match is found, it sends a message to your account with a link to the matching message, indicating which specific keywords were found and which channel the message was found in

## Troubleshooting

- If you encounter authentication issues, delete any session files and try again
- Make sure your API credentials are correct:
  - API_ID must be a number (no quotes)
  - API_HASH must be a string (no quotes needed in .env file)
  - Double-check for typos in your API_HASH
  - If you get "AUTH_KEY_UNREGISTERED" errors, your credentials may be incorrect
- Ensure all channel usernames are entered without the @ symbol and are comma-separated
- Check that your user ID is correct
- Make sure your phone number is in international format (e.g., +1234567890) with the country code
- Common API credential errors:
  - "API ID invalid" - Make sure your API_ID is a number and correctly copied from my.telegram.org
  - "API Hash invalid" - Verify your API_HASH is exactly as shown on my.telegram.org
  - "Phone code invalid" - The code sent to your Telegram app was entered incorrectly
  - "Phone code expired" - Request a new code if too much time has passed

## FAQ About API Credentials

**Q: What are API ID and API Hash?**  
A: These are credentials provided by Telegram that allow your application to interact with the Telegram API. Think of them as your application's username and password for accessing Telegram's services.

**Q: Are API credentials the same as my Telegram account?**  
A: No. API credentials are specific to an application you register, not to your personal account. You can create multiple applications with different credentials.

**Q: Is it safe to use these credentials?**  
A: Yes, when used properly. However, you should never share your API credentials publicly or commit them to public repositories. Always store them in a secure .env file that is excluded from version control.

**Q: Do I need to create new credentials for each device?**  
A: No. The same API credentials can be used across multiple devices. They are tied to your application, not to a specific device.

**Q: Can I use someone else's API credentials?**  
A: This is against Telegram's Terms of Service and can result in your application being blocked. Always create and use your own credentials.

**Q: What if I forget my API credentials?**  
A: You can always visit https://my.telegram.org/apps again to view your existing applications and their credentials.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
