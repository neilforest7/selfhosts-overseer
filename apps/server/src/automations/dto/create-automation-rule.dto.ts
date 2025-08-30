import { IsString, IsOptional, IsJSON, IsBoolean, IsNotEmpty } from 'class-validator';

export class CreateAutomationRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;



  @IsJSON()
  ruleJson: string;
}
