# ONEdevops Clarification Templates

These are the messages posted to Slack when the system needs more information.

## Low Confidence (< 0.7)

```
I'm not fully sure what you're asking for (confidence: {pct}%).

My best guess:
1. {step1}
2. {step2}

Available templates: {templateList}

Try: @ONEdevops onboard <role> for repo <name> template <template>
```

## Repository Not Found

```
Repository "{repoUrl}" not found or not accessible.
Please check the URL and ensure the GitHub token has access.
```

## Template Not Found

```
Template "{templateId}" not found.

Available:
- `default` (Default)
- `node18` (Node.js 18)
- `python3` (Python 3)
- `java-spring` (Java Spring Boot)
```

## Coder Unreachable

```
The Coder workspace platform is currently unreachable.
Your request has been logged (Trace: {traceId}).
Please try again in a few minutes.
```
