import { WebClient } from '@slack/web-api';
import crypto from 'crypto';
import type { SlackApprovalMetadata } from '../types.js';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendApprovalMessage(
  postId: string,
  message: string,
  platform: string
): Promise<SlackApprovalMetadata> {
  const channel = process.env.SLACK_APPROVAL_CHANNEL;

  if (!channel) {
    throw new Error('SLACK_APPROVAL_CHANNEL environment variable is required');
  }

  try {
    const result = await slackClient.chat.postMessage({
      channel,
      text: `New ${platform} post pending approval`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*New ${platform} post pending approval*\n\n${message}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Approve ✓'
              },
              style: 'primary',
              value: postId,
              action_id: `approve_${postId}`
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Reject ✗'
              },
              style: 'danger',
              value: postId,
              action_id: `reject_${postId}`
            }
          ]
        }
      ]
    });

    return {
      channel: result.channel || '',
      messageTs: result.ts || '',
    };
  } catch (error) {
    console.error('Slack send error:', error);
    throw new Error('Failed to send Slack approval message');
  }
}

export function verifySlackSignature(
  slackSignature: string,
  timestamp: string,
  body: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    throw new Error('SLACK_SIGNING_SECRET environment variable is required');
  }

  // Prevent replay attacks - reject requests older than 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');

  // Compare signatures using timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(slackSignature)
  );
}
