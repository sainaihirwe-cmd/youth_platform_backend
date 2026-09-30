const Notification = require('../models/Notification');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

/**
 * Creates an in-app notification and, when SMTP is configured, an email copy.
 * Notification failures must never break the main request, so errors are logged.
 */
async function notify({ userId, title, message, type = 'system', link = '', relatedJobId, relatedApplicationId, email = false }) {
  try {
    const notification = await Notification.create({ userId, title, message, type, link, relatedJobId, relatedApplicationId });
    if (email) {
      const user = await User.findById(userId).select('email name');
      if (user) {
        sendEmail({
          to: user.email,
          subject: `JobConnect Rwanda: ${title}`,
          text: `Hello ${user.name},\n\n${message}\n\n- JobConnect Rwanda`,
        }).catch(() => {});
      }
    }
    return notification;
  } catch (err) {
    console.error(`Failed to create notification: ${err.message}`);
    return null;
  }
}

module.exports = { notify };
