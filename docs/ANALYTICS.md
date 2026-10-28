# Analytics

Both apps count visits and a few actions with a self-hosted Plausible (Community
Edition). The code is `packages/ui/src/io/analytics.ts`; each app starts it in its
`main.tsx`.

## Turning it on

Nothing is counted unless the build is given the site's script, in
`VITE_PLAUSIBLE_SCRIPT`: the `src` of the snippet Plausible shows for the site
(`https://plausible.thomasvanriel.com/js/pa-….js`). The script names the site itself.
mekasim's is set in `netlify.toml`; mekafit's goes in `apps/fit/netlify.toml` once it
has a site of its own in Plausible. The dev servers count nothing: Plausible's script
ignores `localhost`.

The model is never sent. A shared model travels in the part of the link after `#`,
which Plausible does not send, and events say which button was used, never what is in
the model. The only names they carry are those of the built-in examples.

## Events

| Event | App | When | Properties |
|---|---|---|---|
| `New model` | mekasim | "New model" | |
| `Load example` | both | An example is picked | `example`: its id |
| `Open link` | both | A link brings a model in | `model`: `example` or `own`; `example`: its id |
| `Open file` | both | "Open file"/"Open model"/"Add drawing" | `model`: whether a model was among the files; `drawings`: how many DXFs |
| `Download model` | both | "Download" | |
| `Copy link` | both | "Copy link" succeeds | `model`: `example` or `own` |
| `Open in mekasim` | mekafit | "Open in mekasim" | |
| `Make` | mekasim | A download under "Make" | `format`: `DXF`, `3MF`, `STL`, `DXF of the points` |
| `Export CSV` | mekasim | "Export CSV" | |
| `AI skill` | mekasim | The skill is copied or downloaded | `action`: `copy` or `download` |
| `Run study` | mekafit | A study is started | `sample`: how its runs are drawn |

## Goals

Events show in Plausible only once they are goals. In each site: Site settings →
Goals → Add goal → Custom event, one per event of that app above. To see the
properties broken down, add them under Site settings → Custom properties: `example`,
`model`, `drawings`, `format`, `action`, `sample`.

The goals that say most about whether the apps are useful:

- **Make** (mekasim): someone built something. Break it down by `format`.
- **Download model** and **Copy link** (both): someone kept or shared their work.
- **Open link** with `model` = `own`: a shared model was opened, so sharing works.
- **AI skill**: the assistant route is used.
- **Run study** (mekafit): the main thing mekafit is for.
- **Open in mekasim**: models move from mekafit to mekasim.

A funnel on mekasim of `Load example` → `Download model` → `Make` shows how many go
from trying an example to building their own.

The goals can also be added with the Sites API, using a key from Account settings →
API keys with the Sites API scope:

```sh
for goal in "New model" "Load example" "Open link" "Open file" "Download model" \
  "Copy link" "Make" "Export CSV" "AI skill"; do
  curl -sX PUT "$PLAUSIBLE/api/v1/sites/goals" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"site_id\": \"$SITE\", \"goal_type\": \"event\", \"event_name\": \"$goal\"}"
done
```

For mekafit: `Load example`, `Open link`, `Open file`, `Download model`, `Copy link`,
`Open in mekasim`, `Run study`.
