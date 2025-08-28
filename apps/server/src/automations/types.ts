import { Rule } from 'json-rules-engine';

// Define a clear type for the rule JSON structure
export interface RuleJson {
  conditions: Rule['conditions'];
  event: Rule['event'];
}
