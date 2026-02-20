import { TwitterApi } from 'twitter-api-v2';
import { CircuitBreaker } from '../circuit-breaker/index.js';

const twitterCircuit = new CircuitBreaker({
  serviceName: 'twitter',
  failureThreshold: 3,
  resetTimeoutMs: 60_000,  // 1 minute
  successThreshold: 1,
});

let twitterClient: TwitterApi | null = null;

function getTwitterClient(): TwitterApi {
  if (twitterClient) {
    return twitterClient;
  }

  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error('Twitter API credentials are not configured');
  }

  // Check for placeholder values
  if (apiKey === '...' || apiSecret === '...' || accessToken === '...' || accessSecret === '...') {
    throw new Error('Twitter API credentials are not configured');
  }

  twitterClient = new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
  });

  return twitterClient;
}

export async function postTweet(content: string): Promise<{ id: string }> {
  return twitterCircuit.execute(async () => {
    try {
      const client = getTwitterClient();
      const tweet = await client.v2.tweet(content);

      if (!tweet.data?.id) {
        throw new Error('Tweet posted but no ID returned');
      }

      return {
        id: tweet.data.id
      };
    } catch (error: any) {
      console.error('Twitter posting error:', error);

      // Handle specific Twitter API errors
      if (error?.code === 401) {
        throw new Error('Twitter authentication failed. Check API credentials.');
      } else if (error?.code === 429) {
        throw new Error('Twitter rate limit exceeded. Please try again later.');
      } else if (error?.data?.detail?.includes('duplicate')) {
        throw new Error('This tweet appears to be a duplicate.');
      }

      throw new Error('Failed to post to Twitter');
    }
  });
}
