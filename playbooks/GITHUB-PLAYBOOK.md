# Playbook: Git and GitHub in a new repository

You are an AI coding agent starting work in a repository that is new, or newly
yours. This file is the companion to `PLAYBOOK.md` and covers one thing: how
the repository itself is set up and how you are expected to behave inside it.

**Read it before the first commit.** One step in here — what the first commit
contains — is the only genuinely irreversible decision in the whole setup, and
it is made in the first five minutes.

## What is in here and what is not

`PLAYBOOK.md` carries the deployment pipeline: the CI workflow file, the deploy
script, the systemd unit, HTTPS, backups. Those are sections 1 to 9 of its
"GitHub, CI and deployment". **This file does not repeat them.** It covers:

| Section | What it settles |
|---|---|
| Before the first commit | The ignore rules, and why this is the one irreversible step |
| Creating the repository | From empty folder to a pushed `main`, including what you cannot do yourself |
| How to commit | Message shape, the mechanics that break on Windows, attribution |
| What never to run | The destructive commands, and why they belong in a deny list |
| Windows and Git Bash | Line endings, path rewriting, and the nested-repo trap |
| Branches and review | When a branch earns itself, and what keeps `main` deployable |
| Secrets on GitHub | Repository secrets, deploy keys, and the forced command |
| A public repository | What changes when anyone can read the tree |
| Handing it on | What the next agent needs in the root |

If this file arrived without `PLAYBOOK.md`, ask the owner for it rather than
improvising the pipeline — most of it is decisions, not conventions.

---

## Before the first commit

Everything else in this file can be undone. **This cannot.** A secret that
reaches a public commit has to be treated as published: forks, clones, the
GitHub API's event feed, search-engine caches and anyone's local copy all keep
it after you delete it, and a force-push rewriting history does not reach any of
them. The repair is **rotation at the provider**, not removal from git. Deleting
it and saying nothing is the worst available outcome, because it looks fixed.

So, in order, before `git add` runs for the first time:

**1. Write `.gitignore` first.** Not after the first commit. A starting point
for a Node app, each line earning its place:

```gitignore
node_modules/
.env
.env.*
data/                  # the database, its WAL, and backups
*.db
*.db-wal
*.db-shm
*.log
.DS_Store
screenshots/           # generated, and large
```

Two traps in that list:

- **`.env*` also matches a template you want committed.** Name the template
  `env.example` with **no leading dot**, so the ignore rule does not catch it
  and nobody has to remember an exception. `.env.example` is the conventional
  name and it is the wrong one here.
- **Ignoring a whole directory hides new things later.** `data/` is right while
  it holds only the database, but if anything checked-in ever belongs there, use
  `data/*` with a `!data/.gitkeep` rather than widening the rule by hand later.

**2. Prove the ignore rules work before trusting them.**

```bash
git add -A
git status --short          # read every line
git status --ignored --short # confirm .env and data/ appear as ignored, not staged
```

A file already tracked is **not** un-tracked by adding it to `.gitignore`. If
you find one staged that should not be, `git rm --cached <path>` and check
again.

**3. Decide public or private now**, because it changes what may exist in the
tree at all. See "A public repository" below. If the owner has not said, ask —
it is not a default you get to pick.

**4. Look at what you are about to publish.** Read the file list, not just the
count. `git diff --cached --stat` for the shape, then open anything you did not
write yourself. This is the one moment where reading before acting is cheap.

---

## Creating the repository

### You probably cannot create it yourself

`gh repo create` needs an authenticated GitHub CLI, and `gh auth login` is
interactive — it wants a browser or a pasted token, neither of which you can
drive. On many machines `gh` is not installed at all. **Do not improvise around
this** with a raw API call carrying a token you found: you would be using a
credential for something the owner did not ask for.

Ask the owner to create the empty repository in the browser and give you the
URL. One sentence is enough: *"Create an empty repo (no README, no .gitignore,
no licence) and paste me the URL."* An empty one matters — GitHub's initialising
files make the first push a merge.

### Then

```bash
git init -b main
git remote add origin git@github.com:<owner>/<repo>.git
git add -A
git status --short                  # read it
git commit -F <message-file>        # see "How to commit"
git push -u origin main
```

`-b main` is explicit on purpose: the default branch name varies by git version
and by the user's config, and everything downstream — the CI trigger, the
deploy gate, branch protection — names `main`.

### What the first commit should contain

The skeleton, not the app: `package.json`, `tsconfig.json`, `.gitignore`,
`env.example`, `README.md`, the empty source layout, and the handbook
(`CLAUDE.md`). A first commit that is the finished app gives the owner nothing
to review and no point to return to.

---

## How to commit

### The message

Subject line in the imperative, under about 70 characters, no trailing full
stop. Then a blank line, then prose that says **why** — what the code does is
in the diff, and the reason is not. Where a decision was contested, record the
decision and what it was chosen over.

```
Cap verb infinitives at one per ten words added

Enforced rather than documented, because an intention did not survive one
batch. It refuses the whole batch instead of trimming it: which verbs to
keep is a decision about what to study next and belongs to the owner.
```

Append whatever attribution lines the owner's instructions specify, exactly as
written. Do not invent them and do not leave them off.

### Write the message to a file and use `-F`

```bash
git commit -F path/to/message.txt
```

**Not** `-m` with a heredoc. A shell heredoc passed through a wrapped
`bash -c '…'` breaks on the first apostrophe — `the app's`, `learner's`, `don't`
— and the shell reports `unexpected EOF` far from the real cause. Prose messages
are full of apostrophes. Write the file with a file-writing tool, then point
`-F` at it.

The same applies to any script you need to run: **write it to a file and run the
file.** Beyond apostrophes, a command containing `${...}` and quotes together
can trip a harness's safety classifier ("expansion obfuscation") and stop to ask
the owner for approval — every time. A file written with a write tool and then
executed costs one approval instead of one per attempt.

### Scope and rhythm

- **One logical change per commit.** The commit is the unit of review and the
  unit of revert; a commit that does three things can only be undone as three.
- **Commit the documentation with the change that makes it true**, not after.
- **Prefer a new commit to amending.** Amend only something unpushed, and never
  something anyone else may have fetched.
- **Commit or push only when the owner asks**, unless they have said otherwise.
  Finishing work and leaving it staged is a legitimate stopping point; pushing
  is an outward-facing act, and on a repo that auto-deploys it is a deploy.
- **If `main` deploys itself, say so before you push.** "I'll push this" and "I
  will put this live" are the same sentence in that repo, and only one of them
  is what the owner heard.

---

## What never to run

These belong in the harness's **deny list**, not only in prose, because the cost
of one slip is the owner's work:

```
git push --force      git push -f        git reset --hard
git clean             git filter-branch  git filter-repo
rm -rf
```

- **`--force` / `-f`** discards commits that exist only on the remote, which may
  be the owner's own work pushed from another machine. If history genuinely has
  to be rewritten — a committed secret — that is a conversation, and rotation
  comes first regardless.
- **`reset --hard` and `clean`** destroy uncommitted work, which is by
  definition not recoverable from git. When you want a clean tree, `git stash`
  is the reversible version.
- **Interactive flags do not work here at all.** `git rebase -i`, `git add -i`,
  anything that opens an editor: they hang waiting for input that never comes.
  Use the non-interactive equivalent or leave it to the owner.

Two more worth stating because they are easy to reach for:

- **Never commit a credential, even "temporarily".** There is no temporary.
- **Never disable a hook to get a commit through** (`--no-verify`) or skip
  signing. A failing hook is information.

---

## Windows and Git Bash

A repository worked on from Windows has specific, repeatable traps. All of these
have cost real time.

### Line endings

Git's `core.autocrlf` converts on checkout and commit, which means a repository
can end up with **mixed endings on disk** — some files CRLF, some LF — while git
shows nothing wrong. Two consequences for you:

- **`sed` under Git Bash silently strips the CR**, so a one-line edit rewrites
  the whole file's endings and the diff is every line. Do edits through a
  file-editing tool, or through a script that reads with the newline mode
  preserved, edits, and writes back in the ending the file already had.
- **A diff that is "every line changed" is almost always this**, not a real
  change. Check before concluding anything.

The durable fix is a `.gitattributes` committed at the start:

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
```

That makes the repository LF in git and lets the working tree be whatever the
platform wants, which is the behaviour everyone assumes they already have.

### Path rewriting

Git Bash rewrites a leading `/path` argument into a Windows path, so a script
taking a URL path receives `C:/Program Files/...`. Prefix the command with
`MSYS_NO_PATHCONV=1`.

### The accidental outer repository

Running `git init` one directory too high — in `Documents/GitHub`, say, rather
than `Documents/GitHub/<project>` — creates a repository that contains every
project in that folder. Nothing breaks day to day, and then one `git add .` from
the wrong working directory stages all of them.

**Check before the first commit** that you are where you think you are:

```bash
git rev-parse --show-toplevel
```

If that prints a parent of the project, stop and tell the owner rather than
committing. Removing a nested `.git` is their call.

---

## Branches and review

**`main` is deployable and `main` stays green.** If pushing to `main` deploys,
that is not a slogan — a red `main` is a broken site.

A branch earns itself when:

- the change is large enough that the owner should see it whole before it is
  live;
- the work happens somewhere that cannot verify it fully, such as a cloud or
  phone session with no access to the real server, where **the pull request is
  the review step**;
- you are on the default branch and about to commit something the owner has not
  seen. Branch first.

Otherwise small, verified changes on `main` are fine and keep the history
readable. Do not open a pull request for a typo.

Delete a branch once it is merged. A list of stale branches is a list of
decisions nobody made.

---

## Secrets on GitHub

### Secrets and variables are different things

- **Secrets** (Settings → Secrets and variables → Actions → Secrets) are
  write-only: a workflow can use one, nobody can read it back, and the log
  redacts it. Keys, passwords, host fingerprints.
- **Variables** are plain text and readable. Flags and names.

A useful variable: a **deploy gate** such as `DEPLOY_ENABLED`, which the deploy
job tests with `if: ${{ vars.DEPLOY_ENABLED == 'true' }}`. Until the server
exists, pushes run the checks and skip the deploy, so CI is useful from the
first commit instead of failing noisily for a week.

### Two different keys, pointing opposite ways

Keep them straight or you will grant more than you meant:

1. **A deploy key on the repository**, so the *server* can pull. Add it under
   the repository's Deploy keys, **read-only** — leave "Allow write access"
   unticked. The server never pushes. Its private half lives on the server.
2. **An SSH key in Actions secrets**, so *CI* can reach the server. Its public
   half goes in the server's `authorized_keys`.

Pin the server's host key too (`DEPLOY_KNOWN_HOSTS` plus
`StrictHostKeyChecking=yes`), or the workflow will cheerfully authenticate to
anything answering on that address.

### The forced command — the important one

An SSH key that can run anything can run anything *a pushed commit tells it to*.
If the repository is public, that means a stranger's pull request — or anyone who
ever gets write access — could change what runs as root on the server.

So the server's `authorized_keys` entry pins that key to one command:

```
command="/usr/local/bin/<app>-deploy",restrict ssh-ed25519 AAAA...
```

Whatever the client asks for is ignored; that script runs and nothing else.
`restrict` turns off port forwarding, agent forwarding and a PTY as well.

**The script is installed by hand on the server, not pulled from the
repository.** That is the whole point: if a push could change it, the pin is
decorative. Keep a copy in the repo for review if you like, but say in both
places that the live one is installed manually and must be reinstalled after an
edit.

### Also turn on

- **Secret scanning and push protection** (Settings → Code security). Push
  protection rejects a commit containing a recognised credential *before* it
  lands, which is the only cheap moment.
- **Branch protection on `main`** if more than one person or agent pushes.
- **Dependabot alerts**, and read them rather than auto-merging them.

---

## A public repository changes the rules

If the repository is public, **everything in the tree is published** — including
anything that is merely boring rather than secret.

- **Real email addresses, invite lists and allow-lists are personal data.**
  Gitignore them, and deliberately ship **no template file**: a template is a
  standing invitation for someone to fill it in and commit it. Document the
  format in the handbook instead, and make the code **fail closed** when the
  file is missing, so an absent list denies rather than admits.
- **The handbook itself is published.** Write it for a competent stranger and
  put nothing in it you would not say in public: no keys, no account names, no
  server passwords. Describing the architecture is fine and useful; naming the
  one unprotected endpoint is not.
- **Workflow files are published**, so treat the secrets they reference as the
  only thing standing between a reader and your server. Hence the forced
  command.
- **A fork keeps whatever you later delete.** See the top of this file.

---

## Handing the repository to the next agent

The repository has to teach the next session what this one learned, because
nothing else will.

- **`CLAUDE.md` in the root** is loaded automatically by every future session.
  It holds decisions and the reasons for them, the traps that cost time, and the
  commands that verify a change. Not a description of the code, which the code
  already gives.
- **Update it in the same change that makes it true**, unprompted. A handbook
  written up at the end is a handbook written from memory.
- **Record what went wrong, not just what was decided.** "This looked like a
  broken feature and was a bad test" saves the next session an afternoon.
- **These playbooks travel with it.** Copy the whole `playbooks/` folder into the
  new repository. If a practice here changes, change it in the playbook too, or
  the copy in the next repository teaches the old way.

---

## Checklist

Before the first push:

- [ ] `.gitignore` written and **verified** with `git status --ignored`
- [ ] `env.example` committed; `.env` ignored and not tracked
- [ ] Public or private settled with the owner
- [ ] `git rev-parse --show-toplevel` is the project, not a parent
- [ ] `.gitattributes` committed if anyone works on Windows
- [ ] The staged file list read line by line

Once the server exists:

- [ ] Read-only deploy key on the repository, for the server's pull
- [ ] Actions secret holding the CI key, with the host key pinned
- [ ] `authorized_keys` entry pinned with `command="…",restrict`
- [ ] The deploy script installed by hand, and said so in two places
- [ ] Deploy gate variable set only when the server is actually ready
- [ ] Secret scanning and push protection on
- [ ] A push to `main` tried once, end to end, and watched
