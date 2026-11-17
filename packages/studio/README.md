# studio

The agents that build the apps in this repository. It holds no app of its own.

## app-builder

Turns a topic, and any articles on it, into a public data app in a new package under `packages/`. Start it in the
community-apps environment in Credible: in a chat, pick `app-builder` and ask for an app, for example "Build an
app on this year's measles cases in the US. High effort." It finds openly licensed data, models it in Malloy,
builds the app in its own agent computer and opens a pull request on this repository.

Merging that pull request publishes the app. The app's `community-card.json` then reaches `main`, and the
[community-card workflow](../../.github/workflows/community-card.yml) opens a pull request on the community site
listing it. Merging that one deploys the site.

- `agents/app-builder/instructions.md`: what the agent does and the rules it keeps.
- `agents/data-app-skills/`: how it finds and fetches data, builds an app, and draws its card art.
- `scripts/card_art.py`: the check a card's art must pass, run by the agent and by the listing workflow.
- `templates/data-app/`: the page, frame, chart module and styles each app starts from. The agent computer mounts
  this package read-only beside the app, and the skills copy from here.

The skills and the templates live here: change them in this package. Running the agent needs the right to edit
this package, since its agent computer mounts it.

## Its two tasks

- **Propose topics** (`agents/app-builder/tasks/propose-topics.md`) refreshes `topics.md` here: three to five
  topics in the news with open data behind them, ranked, each with the package name it would get. It runs only on
  a schedule: on the agent's page in Credible, Add schedule on the task's row. Each run opens a pull request on
  this package; reorder or edit the list there, add your own with `Added by:`, and merge. While that pull request
  is open, later runs stop.
- **Build next topic** (`agents/app-builder/tasks/build-next-topic.md`) builds one topic from the list. Press Run
  now with the topic's package name as the note. Never schedule it: a scheduled run cannot create a package.

`publisher.json` needs a `cron` beside each task. It is only the intended rhythm, weekly for proposals; nothing
runs until someone adds a schedule on the agent's page.
