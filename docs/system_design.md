## Functional Requirements

1. The agent should be able to generate social content using an LLM
2. The agent should be able to post to a least one social media platform
3. The agent must only post after user approval via Slack 

## Non-Functional Requirements

1. The agent should be integrated with multiple LLMs to ensure better reliability and prevent too much of a tight coupling
2. CAP Theorem: Availability over Consistency. There’s no need for strong consistency, eventual consistency is okay.
3. Latency (response/feedback to users) should be < 500ms
User facing endpoints not the whole flow.
4. Scalability: use queues, retries, circuit breaker patterns to handle issues with 3rd party integration. Also, rate limiting by IP address using token bucket approach.

## Data Model

I will use a SQLite database because of its simplicity.

`social_platforms` 

| Column | Type | Remark |
| --- | --- | --- |
| id | PK (uuid) |  |
| slug | TEXT |  |
| name | TEXT/VARCAR |  |
| word_limit | number |  |
| created_at | DATETIME |  |
| updated_at | DATETIME |  |

`posts`

| Column | Type | Remark |
| --- | --- | --- |
| id | PK (uuid) |  |
| message | LONG TEXT |  |
| status | ENUM (pending, approved, rejected, posted, failed_post, failed_approval_send) | Can be extended |
| social_platform_id | FK | Indicates which social media to be posted to |
| external_id | ID | Indicates link to the post, if approved and posted successfully. |
| approved_at | DATETIME |  |
| approved_by | TEXT |  |
| rejected_by | TEXT |  |
| approval_source | TEXT | We can log the Slack message ID, channel, user |
| llm_provider | TEXT |  |
| llm_model | TEXT |  |
| prompt | LONG TEXT |  |
| raw_output | LONG TEXT |  |
| created_at | DATETIME |  |
| updated_at | DATETIME |  |

## API Endpoints

1. POST `/posts/generate` 
    
    `{`
    
    `“query”: “…”,
    ”social_platform”: “x | instagram | linkedin”`
    
    `}`
    This will trigger the Agent to generate a post.
    Flow will be: Get user input on what post to generate, combine with internal settings/prompt, generate a post (save to DB). Then, send to slack.
    
2. POST `/slack/actions`[private]
{
   “action”: “approve | reject”
}
    
    *Security*: Ensure to verify the user accessing this endpoint is a Slack user with signature
    
    *Concurrency*: Use a DB transaction to lock update and prevent double posting (WHERE status is …)
    
    *Idempotency*: Use `external_id` as idempotency key to prevent multiple posts
    
    Update the post: either reject or approve.
    This is when the agent will then send this to the appropriate social media platform, if approved
    

## Edge Cases or Unhandled Decisions

1. If a call to an LLM fails, use another
2. If it all fails, return a reasonable error message back to the user
Something like: “Unable to generate content right now. Please try again”
3. Prevent approval after rejection and vice versa.
If one of those has happened, reject any other updates to status.
Return message to user: “The post has already been [rejected/approved]”
4. This might already implicitly also handle the case where the user clicks multiple times on a button on Slack.
5. If the Agent is not able to send to slack for approval? Retry. We probably also need to implement a queue to handle this (if at scale), then, have a dead letter queue for issues with 3rd party integration failures.
So, with Slack, we can have a “dlq_slack” queue that holds those which can be later manually retried for them to continue from where they left off. Also, we would have the data in DB
6. What if posting does not work? Similar approach as above can be used as well.