# ONEdevops Demo Script

## Pre-Recording Checklist

- [ ] Close unnecessary apps/notifications (Do Not Disturb ON)
- [ ] Browser tabs ready:
  - Tab 1: Slack workspace (ONEdevops channel)
  - Tab 2: Jira - https://vinkum003.atlassian.net/ (open a ticket)
  - Tab 3: Coder - https://labcoder.stage.0658b-techopscore.com/ (logged in)
- [ ] Terminal open with project dir: `cd ~/Documents/onedevops-automation`
- [ ] Font size bumped up in browser (Cmd + plus, 125-150%)
- [ ] Delete any old test workspaces in Coder to keep it clean

## Recording Setup

Press **Cmd + Shift + 5** → Record Entire Screen → Click Record

---

## SCENE 1: Introduction (15 seconds)

**Show:** Terminal or VS Code with the project open

**Say:**
> "This is ONEdevops — an AI-powered developer workspace automation platform built on iTmethodsONE. It lets teams provision fully configured Coder workspaces from Slack or Jira using natural language. Let me show you how it works."

---

## SCENE 2: Architecture Overview (20 seconds)

**Show:** Switch to browser/slide with this flow (or just say it)

**Say:**
> "The architecture is simple. A developer sends a message in Slack or a Jira comment. That triggers an AWS Lambda which calls Amazon Bedrock to parse the intent using AI. Bedrock returns a structured plan — which template, which repo, what branch. Then we call the Coder API to spin up a Kubernetes workspace, clone the repo, and configure everything. The developer gets a link to a ready-to-code environment in under two minutes."

---

## SCENE 3: Slack Demo (60-90 seconds)

### Step 1 — Send the command

**Show:** Slack channel

**Type in Slack:**
```
@ONEdevops onboard backend dev for repo payments-api template python3
```

**Say:**
> "Here in Slack, I mention @ONEdevops with a natural language request — onboard a backend developer for the payments-api repository using the Python 3 template."

### Step 2 — Bot responds with plan

**Show:** Wait for the bot's first response (the plan message with template, repo, branch, steps)

**Say:**
> "Within seconds, ONEdevops responds with the AI-generated provisioning plan — the template it selected, the repository, the onboarding branch, and the step-by-step execution plan."

### Step 3 — Status updates

**Show:** Watch the thread for status updates (Creating workspace → Building → Cloning → Ready)

**Say:**
> "It's now creating the workspace on our Kubernetes cluster, building the container, and cloning the repository. All status updates stream back in real-time in the Slack thread."

### Step 4 — Workspace ready

**Show:** Click the workspace URL when it appears

**Say:**
> "And it's ready. Clicking the link opens VS Code in the browser — the repo is cloned, git identity is configured, and GitHub Copilot is pre-installed. The developer can start coding immediately."

### Step 5 — Show the workspace

**Show:** The code-server IDE in the browser. Open a file, show the terminal.

**Say:**
> "This is a full VS Code environment running on Kubernetes — terminal, extensions, everything a developer needs."

**Action:** Close the workspace tab, go back to Slack.

---

## SCENE 4: Jira Demo (60-90 seconds)

### Step 1 — Open a Jira ticket

**Show:** Switch to Jira browser tab, open any ticket

**Say:**
> "Now let me show the same flow from Jira. This is useful when workspace provisioning is tied to a specific ticket or sprint task."

### Step 2 — Add a comment

**Type in Jira comment box:**
```
ONEdevops onboard frontend dev for repo frontend-app template nodejs20
```

**Say:**
> "I add a comment on the ticket mentioning ONEdevops with the request — this time for a Node.js 20 workspace."

**Action:** Click Save / Submit the comment.

### Step 3 — ONEdevops responds

**Show:** Refresh the ticket comments after ~10-15 seconds. ONEdevops will post comments back.

**Say:**
> "ONEdevops picks up the comment via a webhook, runs the same AI pipeline, and posts status updates right back on the Jira ticket. The entire team can see the provisioning progress without leaving Jira."

### Step 4 — Workspace ready

**Show:** Wait for the completion comment with the workspace URL. Click it.

**Say:**
> "Workspace is ready. Same result — a fully configured development environment, but triggered and tracked within the Jira workflow."

---

## SCENE 5: Coder Dashboard (15 seconds)

**Show:** Switch to Coder dashboard tab

**Say:**
> "In the Coder dashboard, you can see both workspaces we just created — the Python one from Slack and the Node.js one from Jira. Admins can manage, stop, or delete workspaces from here."

---

## SCENE 6: Wrap-up (15 seconds)

**Show:** Terminal or project in VS Code

**Say:**
> "That's ONEdevops — natural language developer onboarding powered by Amazon Bedrock AI, automated through Coder on Kubernetes, integrated with both Slack and Jira. From request to ready-to-code in under two minutes."

---

## Total Time: ~3-4 minutes

## Post-Recording

1. Stop recording (click stop in menu bar)
2. Video saves to Desktop as `.mov`
3. Optional: trim with QuickTime (Edit → Trim) or iMovie
4. Convert to MP4 if needed:
   ```bash
   ffmpeg -i ~/Desktop/Screen\ Recording*.mov -c:v libx264 -crf 23 -preset medium ~/Desktop/onedevops-demo.mp4
   ```

## Cleanup After Demo

Delete test workspaces to avoid resource costs:
```bash
# List workspaces
curl -s -H "Coder-Session-Token: $CODER_TOKEN" \
  https://labcoder.stage.0658b-techopscore.com/api/v2/workspaces | jq '.workspaces[].name'

# Delete a workspace
curl -X DELETE -H "Coder-Session-Token: $CODER_TOKEN" \
  https://labcoder.stage.0658b-techopscore.com/api/v2/workspaces/{workspace-id}
```

## Troubleshooting During Demo

| Issue | Quick Fix |
|-------|-----------|
| Slack bot doesn't respond | Check Lambda logs: `aws logs tail /aws/lambda/onedevops-orchestrator-stage --profile onedevops --follow` |
| Jira comments don't trigger | Verify webhook is registered in Jira Settings → System → Webhooks |
| Workspace stuck building | Check Coder dashboard, may need to cancel and retry |
| code-server not loading | Wait 30s for startup script to finish, then refresh |
