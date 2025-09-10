import { IsString, IsOptional, IsJSON, IsBoolean, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TestTriggerDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsJSON()
  @IsOptional()
  config?: string;

  @IsJSON()
  @IsOptional()
  conditions?: string;
}

export class TestEventDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsJSON()
  @IsOptional()
  params?: string;

  @IsJSON()
  @IsOptional()
  options?: string;
}

export class TestAutomationRuleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestTriggerDto)
  @IsOptional()
  triggers?: TestTriggerDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestEventDto)
  @IsOptional()
  events?: TestEventDto[];

  @IsJSON()
  @IsOptional()
  context?: string;

  @IsBoolean()
  @IsOptional()
  validateOnly?: boolean;
}
