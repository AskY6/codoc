// Component mapping provided to the MDX renderer.
// Maps JSX tag names in MDX source to React components.

import type { ComponentType } from "react";
import {
  AdjustmentSuggestion,
  Anomaly,
  AnomalyList,
  CalibrationMatrix,
  Evidence,
  ExtractedFact,
  Highlight,
  Improvement,
  MaterialHeader,
  PersonRow,
  RankingSuggestion,
  ReviewHeader,
  ScoreCard,
  Summary,
  WeightedTotal,
} from "./perf-review.js";

export const codocComponents: Record<string, ComponentType<any>> = {
  MaterialHeader,
  ReviewHeader,
  ScoreCard,
  Highlight,
  Improvement,
  Evidence,
  ExtractedFact,
  WeightedTotal,
  Summary,
  CalibrationMatrix,
  PersonRow,
  AnomalyList,
  Anomaly,
  AdjustmentSuggestion,
  RankingSuggestion,
};
