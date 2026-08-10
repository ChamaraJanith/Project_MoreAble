/**
 * Accessibility Profile Entity Models and Types
 */

export interface WalkingDifficultyNeeds {
  needsRamp: boolean;
  needsWheelchair: boolean;
  needsPrioritySeat: boolean;
}

export interface LowVisionNeeds {
  needsClearAnnouncement: boolean;
  needsVibratedDevice: boolean;
  needsPrioritySeat: boolean;
}

export interface HearingImpairmentNeeds {
  needsVibratedDevice: boolean;
  needsPrioritySeat: boolean;
  needsVisualAnnouncement: boolean;
}

export interface OtherAccessibilityNeeds {
  description?: string;
  automateSupportBuses: boolean;
}

export interface AccessibilityProfile {
  profileId: string;
  userId: string;
  walkingDifficulty: WalkingDifficultyNeeds;
  lowVision: LowVisionNeeds;
  hearingImpairment: HearingImpairmentNeeds;
  otherNeeds: OtherAccessibilityNeeds;
  createdAt: string;
  updatedAt: string;
}

export type AccessibilityNeedType = 'WALKING' | 'VISION' | 'HEARING' | 'OTHER';
