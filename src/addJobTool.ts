import * as z from 'zod/v4'
import { addJob, type AddJobInput, type AddJobOutcome } from './addJobClient.js'
import type { Config } from './config.js'

export const ADD_JOB_TOOL_NAME = 'add_job'

export const ADD_JOB_DESCRIPTION =
  "Add one job position to the user's Job Hunter Board (it lands in the New column). " +
  "Call once per position. The job is always added to the owner of the configured Job Hunter integration token; " +
  'you never need or can choose a user. Do not check beforehand whether the job already exists: ' +
  'Job Hunter detects duplicates itself and will say so. Only pass information you actually have; ' +
  'omit unknown optional fields instead of guessing or inventing them. ' +
  'If, and only if, you have actually evaluated this job against the user\'s CV/context, you may also pass your evaluation ' +
  '(fitScore, matchingSkills, missingSkills, concerns, evaluationModel); Job Hunter stores it as an "External AI" match shown in the ticket\'s AI match section ' +
  'and does not re-evaluate it. Never invent a fit score or match/gap details; omit every evaluation field when you have not evaluated the job. ' +
  'The job\'s source is set by Job Hunter; you do not provide it.'

export const addJobInputSchema = z.object({
  title: z.string().describe('Job title exactly as published, e.g. "Senior Backend Engineer". Required.'),
  companyName: z.string().optional().describe('Hiring company name. Omit if unknown; never guess.'),
  description: z
    .string()
    .optional()
    .describe('Job description / requirements text as found in the posting. Omit if not available; do not summarise from memory.'),
  location: z.string().optional().describe('Job location as stated, e.g. "Tel Aviv" or "Berlin, Germany". Omit if unknown.'),
  workModel: z
    .string()
    .optional()
    .describe('Work model as stated in the posting, e.g. "Remote", "Hybrid" or "On-site". Omit if not stated.'),
  url: z.string().optional().describe('Full http(s) link to the job posting. Only use a URL you actually saw; never invent one.'),
  salaryMin: z.number().int().optional().describe('Minimum salary as a whole number (no currency symbol). Omit unless explicitly stated.'),
  salaryMax: z.number().int().optional().describe('Maximum salary as a whole number (no currency symbol). Omit unless explicitly stated.'),
  currency: z.string().optional().describe('Salary currency code, e.g. "USD", "EUR", "ILS". Omit unless a salary is stated.'),
  fitScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Optional external assessment of how well the job matches the user's CV, an integer 0-100. " +
        'Provide it only if you actually evaluated the job against the CV/context; never invent it. ' +
        'Required if you pass any other evaluation field below; omit all evaluation fields when unavailable.',
    ),
  matchingSkills: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of reasons, requirements or skills that match the user's CV " +
        '(short explanatory phrases are fine). Only with fitScore, and only what you actually found; never invent.',
    ),
  missingSkills: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of gaps: requirements not clearly satisfied by the user's CV (shown as \"Gaps\"). " +
        'Only with fitScore, and only what you actually found; never invent.',
    ),
  concerns: z
    .array(z.string())
    .optional()
    .describe('Optional additional concerns about this job for the user. Only with fitScore; never invent.'),
  evaluationModel: z
    .string()
    .optional()
    .describe(
      'Optional name of the external AI model that produced the evaluation, e.g. "Claude Opus 5.5". ' +
        'Only with fitScore, and only if you reliably know it; otherwise omit.',
    ),
})

export interface ToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

const label = (title: string, company: string | null) => (company ? `${title} - ${company}` : title)

export function describeOutcome(outcome: AddJobOutcome): ToolResult {
  const text = (value: string, isError = false): ToolResult => ({
    content: [{ type: 'text', text: value }],
    ...(isError ? { isError: true } : {}),
  })
  switch (outcome.kind) {
    case 'created':
      return text(
        `Added: ${label(outcome.title, outcome.companyName)}. Status: ${outcome.statusLabel}.` +
          (outcome.importedFitScore !== null ? ` Imported fit: ${outcome.importedFitScore}%.` : ''),
      )
    case 'duplicate':
      return text(`Job was not added because it already exists. (${label(outcome.title, outcome.companyName)})`)
    case 'validation':
      return text(
        outcome.problems.length > 0
          ? `Job Hunter rejected the job: ${outcome.problems.join('; ')}.`
          : 'Job Hunter rejected the job because some fields are invalid. Check the title and URL.',
        true,
      )
    case 'auth':
      return text(
        'Job Hunter authentication failed. The integration token may be missing, invalid, replaced, or revoked.',
        true,
      )
    case 'unavailable':
      return text('Could not connect to the local Job Hunter backend. Make sure it is running.', true)
    case 'error':
      return text('Job Hunter could not add the job because of an unexpected backend error. Try again later.', true)
  }
}

export async function runAddJob(
  config: Config,
  input: AddJobInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ToolResult> {
  return describeOutcome(await addJob(config, input, fetchImpl))
}
