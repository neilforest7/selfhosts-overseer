import { IsOptional, IsString } from 'class-validator';

export class TestAutomationRuleDto {
  @IsString()
  @IsOptional()
  opId?: string; // Operation ID for tracking the test execution

  @IsOptional()
  customFacts?: Record<string, any>; // Optional custom facts for testing
}
