import { useState } from 'react'

interface Section {
  heading: string
  items: string[]
}

const OWNER_GUIDE: Section[] = [
  {
    heading: 'Welcome to Benchmark',
    items: [
      'Benchmark helps you run construction projects from first contact to final payment.',
      'As the owner, you see everything: projects, money (draws & contract totals), documents, change orders, your team, and templates.',
      'Tip: Start by creating a project, then check off benchmarks as work gets done — progress updates automatically.',
    ],
  },
  {
    heading: 'Creating a Project',
    items: [
      'From the dashboard, each project type (New Build, Renovation, Roofing) has its own section with a "+ New" button.',
      'Pick a template when creating: preloaded ones (like Slab or Crawlspace for New Builds) load a full checklist automatically.',
      'Choose "Custom scope" to either build a reusable template first, or start the job empty and add phases yourself.',
      'Tip: The template you pick sets the phases, benchmarks, and a rough schedule — you can always adjust them on the project afterward.',
    ],
  },
  {
    heading: 'Phases & Benchmarks',
    items: [
      'Phases are the big stages of a job (Foundation, Framing, etc.). Benchmarks are the checklist items inside each phase.',
      "Check off a benchmark when it's done; the phase progress bar fills in automatically.",
      "Mark an item \"N/A\" when it doesn't apply to this job — it won't count against progress.",
      'As owner you can add, rename, reorder (arrows), and delete phases and benchmarks right on any project.',
      'Tip: Inspection items and procurement/ordering items are flagged so nothing critical slips through.',
    ],
  },
  {
    heading: 'Draws & Money',
    items: [
      'Draws are your payment schedule — tied to phases, released as work completes.',
      'Only owners see draw amounts and contract totals. PMs never see the money.',
      'Mark a draw "released" when the bank funds it, with the date.',
      'Tip: Keep draw invoices in Documents so everything for a draw lives in one place.',
    ],
  },
  {
    heading: 'Change Orders & E-Signing',
    items: [
      'Create a change order when scope or cost changes mid-job.',
      'Generate a signing link and send it to your customer — they sign on their phone (typed name + drawn signature).',
      'Once signed, the change order locks. To change it, void it and create a new one.',
      'Download a signed PDF for your records or the bank.',
      "Tip: The signature, date, and IP are all captured — it's a real, defensible record.",
    ],
  },
  {
    heading: 'Documents',
    items: [
      'Upload plans, budgets, invoices, permits, and COIs per project.',
      "Categorize them (Plans, Invoice, Bank Estimate, etc.) so they're easy to find.",
    ],
  },
  {
    heading: 'Your Team',
    items: [
      'Invite project managers from the Team page — generate an invite link and send it to them.',
      'PMs see the projects you assign them, including plans and change orders, but NOT draws or contract dollar totals.',
      'Remove a member anytime; it revokes their access.',
    ],
  },
  {
    heading: 'Templates (Owner Only)',
    items: [
      'The Templates page is where you build reusable checklists.',
      'Create a custom template, assign it to a type, and add phases (with durations) and benchmarks.',
      'Duplicate any template (even a preloaded one) to make a tweaked copy without starting over.',
      'Your custom templates automatically appear in the create-project picker under "Custom Templates."',
      'Tip: Duplicate Roofing, adjust a few items, and save it as your own crew’s version.',
    ],
  },
  {
    heading: 'Client Selections',
    items: [
      'Selections let your clients choose their own finishes — paint colors, cabinets, hardware, flooring, and more — instead of you tracking it all by phone or text.',
      'Build selection lists on the Selections page (owner only): create a list, add questions, and choose the question type — multiple choice, short text, or yes/no.',
      'Duplicate any list to make a variation without starting over — for example, a "Standard Finishes" list and a "Premium Finishes" list.',
      'When you create a project, pick which selection list it uses. Any project type can have one.',
      "Share the project's selection link with your client. They pick their finishes on their phone or computer, and their choices save automatically — you'll see them on the project.",
      "Tip: Start from your default list and tweak it per client. Keep option names clear (e.g. exact paint color names) so there's no confusion later.",
      'Tip: Add an "upcharge note" to any option that costs extra, so clients see the cost before they choose.',
    ],
  },
  {
    heading: 'Account & Password',
    items: [
      'Change your password anytime from the Team page.',
      'Forgot it? Use "Forgot password?" on the login screen to get a reset link.',
    ],
  },
]

const PM_GUIDE: Section[] = [
  {
    heading: 'Welcome to Benchmark',
    items: [
      "Benchmark is your job checklist and project hub. You'll track progress, check off work, and keep documents organized.",
      'You see the projects assigned to you — their phases, benchmarks, plans, documents, and change orders.',
      "Note: Money details (draw amounts, contract totals) are owner-only — you won't see those, and that's by design.",
    ],
  },
  {
    heading: 'Your Projects',
    items: [
      "The dashboard shows the jobs you've been assigned.",
      'Open a project to see its phases and the benchmark checklist inside each one.',
    ],
  },
  {
    heading: 'Checking Off Work',
    items: [
      'Tap a benchmark to mark it complete — the phase progress bar updates automatically.',
      'Set the completed date if it finished on a different day.',
      "Mark items \"N/A\" when they don't apply to this job.",
      'Tip: Watch for inspection items and ordering/procurement items — those are the ones that hold up a job if missed.',
    ],
  },
  {
    heading: 'Documents',
    items: [
      "Find project plans, permits, and other documents under the project's Documents.",
      'Upload photos or files from your phone right on the job site.',
    ],
  },
  {
    heading: 'Change Orders',
    items: [
      "You can view change orders on your assigned projects, including what changed and the customer's approval.",
    ],
  },
  {
    heading: 'Your Account',
    items: [
      'Change your password anytime from the Team page.',
      'Forgot it? Use "Forgot password?" on the login screen.',
    ],
  },
  {
    heading: 'Getting Help',
    items: ["Ask your account owner if you need access to a project you don't see."],
  },
]

function LightbulbIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden
    >
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" />
    </svg>
  )
}

function GuideItem({ text }: { text: string }) {
  const isTip = text.startsWith('Tip:')
  const isNote = text.startsWith('Note:')

  if (isTip || isNote) {
    return (
      <li className="flex items-start gap-2 rounded-lg border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-relaxed text-ink">
        {isTip ? (
          <span className="text-accent">
            <LightbulbIcon />
          </span>
        ) : (
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            aria-hidden
          />
        )}
        <span>{text}</span>
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2 text-sm leading-relaxed text-ink">
      <span
        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted"
        aria-hidden
      />
      <span>{text}</span>
    </li>
  )
}

function Guide({ sections }: { sections: Section[] }) {
  return (
    <div className="mx-auto max-w-prose space-y-8">
      {sections.map((s) => (
        <section key={s.heading}>
          <h2 className="text-lg font-semibold text-charcoal">{s.heading}</h2>
          <ul className="mt-3 space-y-2">
            {s.items.map((item, i) => (
              <GuideItem key={i} text={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default function Handbook() {
  const [tab, setTab] = useState<'owner' | 'pm'>('owner')

  const tabClass = (active: boolean) =>
    `min-h-[40px] rounded-lg px-4 text-sm font-semibold transition ${
      active ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
    }`

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-charcoal">Handbook</h1>

      <div className="mb-6 inline-flex rounded-xl bg-field p-1">
        <button
          type="button"
          onClick={() => setTab('owner')}
          className={tabClass(tab === 'owner')}
        >
          Owner Guide
        </button>
        <button
          type="button"
          onClick={() => setTab('pm')}
          className={tabClass(tab === 'pm')}
        >
          PM Guide
        </button>
      </div>

      <Guide sections={tab === 'owner' ? OWNER_GUIDE : PM_GUIDE} />
    </div>
  )
}
