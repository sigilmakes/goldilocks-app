import type { GenerationDefaults } from '../store/context';
import type { Conversation } from '../store/conversations';
import { getPathDisplayName } from './workspaceTabs';

export type PromptTemplateId =
  | 'inspect-structure'
  | 'predict-kpoints'
  | 'generate-qe-input'
  | 'search-structure'
  | 'explain-kpoint-convergence'
  | 'compare-models';

export interface PromptTemplateInput {
  defaults: GenerationDefaults;
  structurePath?: string;
  extraInstructions?: string;
}

export interface PromptTemplateDefinition {
  id: PromptTemplateId;
  label: string;
  shortLabel: string;
  description: string;
  requiresStructure?: boolean;
  buildPrompt: (input: PromptTemplateInput) => string;
  buildConversationTitle?: (input: PromptTemplateInput) => string;
}

function defaultsSummary(defaults: GenerationDefaults) {
  return `functional=${defaults.functional}, pseudo_mode=${defaults.pseudoMode}, prediction_model=${defaults.model}, confidence=${defaults.confidence}`;
}

function withExtraInstructions(base: string[], extraInstructions?: string) {
  const trimmed = extraInstructions?.trim();
  if (trimmed) {
    base.push(`Additional instructions: ${trimmed}`);
  }
  return base.join(' ');
}

export const PROMPT_TEMPLATES: PromptTemplateDefinition[] = [
  {
    id: 'inspect-structure',
    label: 'Inspect structure',
    shortLabel: 'Inspect',
    description: 'Summarise the chemistry, composition, and likely next calculations.',
    requiresStructure: true,
    buildPrompt: ({ structurePath, defaults, extraInstructions }) =>
      withExtraInstructions([
        `Use the workspace structure file "${structurePath}" as the active structure for this conversation.`,
        `Generation defaults: ${defaultsSummary(defaults)}.`,
        'Inspect the structure, summarise the key chemistry or composition, and ask what calculation I want next.',
      ], extraInstructions),
    buildConversationTitle: ({ structurePath }) => `Inspect ${getPathDisplayName(structurePath ?? 'structure')}`,
  },
  {
    id: 'predict-kpoints',
    label: 'Predict k-points',
    shortLabel: 'Predict k-points',
    description: 'Estimate a converged grid using the configured ML model and confidence.',
    requiresStructure: true,
    buildPrompt: ({ structurePath, defaults, extraInstructions }) =>
      withExtraInstructions([
        `Predict a k-point grid for the workspace structure file "${structurePath}".`,
        `Use model ${defaults.model} at confidence ${defaults.confidence}.`,
        `Treat the current generation defaults as ${defaultsSummary(defaults)}.`,
        'Explain the result briefly and keep any useful derived files in the workspace.',
      ], extraInstructions),
    buildConversationTitle: ({ structurePath }) => `K-points for ${getPathDisplayName(structurePath ?? 'structure')}`,
  },
  {
    id: 'generate-qe-input',
    label: 'Generate QE input',
    shortLabel: 'Generate QE input',
    description: 'Create a ready-to-run SCF input file and explain the parameter choices.',
    requiresStructure: true,
    buildPrompt: ({ structurePath, defaults, extraInstructions }) =>
      withExtraInstructions([
        `Generate a Quantum ESPRESSO SCF input file for the workspace structure file "${structurePath}".`,
        `Use ${defaultsSummary(defaults)}.`,
        'Save the resulting input file in the workspace and explain the important choices you made.',
      ], extraInstructions),
    buildConversationTitle: ({ structurePath }) => `QE input for ${getPathDisplayName(structurePath ?? 'structure')}`,
  },
  {
    id: 'search-structure',
    label: 'Find a structure',
    shortLabel: 'Find a structure',
    description: 'Search available structure databases and save a candidate into the workspace.',
    buildPrompt: ({ extraInstructions }) =>
      withExtraInstructions([
        'Help me find a crystal structure from the supported databases and save it into the workspace.',
        'Ask follow-up questions if you need a formula, material name, or database preference.',
      ], extraInstructions),
    buildConversationTitle: () => 'Find a structure',
  },
  {
    id: 'explain-kpoint-convergence',
    label: 'Explain k-point convergence',
    shortLabel: 'Explain convergence',
    description: 'Give a practical explanation of convergence tradeoffs for DFT workflows.',
    buildPrompt: ({ extraInstructions }) =>
      withExtraInstructions([
        'Explain k-point convergence for DFT calculations in practical terms.',
        'Focus on how it affects accuracy, cost, and how Goldilocks chooses sensible defaults.',
      ], extraInstructions),
    buildConversationTitle: () => 'K-point convergence',
  },
  {
    id: 'compare-models',
    label: 'Compare ALIGNN vs RF',
    shortLabel: 'Compare models',
    description: 'Compare the two k-point prediction models and when to trust each one.',
    buildPrompt: ({ extraInstructions }) =>
      withExtraInstructions([
        'Compare the ALIGNN and Random Forest k-point prediction models used in Goldilocks.',
        'Explain tradeoffs, uncertainty, and when each model is likely to be a better choice.',
      ], extraInstructions),
    buildConversationTitle: () => 'ALIGNN vs RF',
  },
];

export function getPromptTemplate(id: PromptTemplateId): PromptTemplateDefinition {
  const template = PROMPT_TEMPLATES.find((entry) => entry.id === id);
  if (!template) {
    throw new Error(`Unknown prompt template: ${id}`);
  }
  return template;
}

export function buildSeededConversationTitle(template: PromptTemplateDefinition, input: PromptTemplateInput): string {
  return template.buildConversationTitle?.(input) ?? template.label;
}

export function findConversationTitle(conversations: Conversation[], id: string): string {
  return conversations.find((entry) => entry.id === id)?.title ?? 'Conversation';
}
