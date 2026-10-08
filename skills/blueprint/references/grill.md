# The grill

Interview until nothing is silently assumed.

- **Frontier.** Ask every decision whose prerequisites are settled, in one round, then wait. A question that depends on an answer still open waits for a later round.
- **Form.** Number questions globally (`Q-001`, never renumbered), the highest-consequence one first, each with your recommendation so a round can be answered in one line:

```
**Q-001 — <title>**: <the decision and the options>
→ <your recommendation, and the one reason it is the best default>
```

- **Facts are yours.** Never ask what the repo answers. Read the file, then ask only what is left.
- **Answers become constraints.** Write each into `## Locked constraints`. "Your call" locks your recommendation, marked delegated. "I don't know" becomes a question with a decision criterion. A later design that contradicts a locked answer goes back to the user.
- **Stop** when the frontier is empty. Then design.
