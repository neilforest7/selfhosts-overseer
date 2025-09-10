import { IsString, IsOptional, IsJSON, IsBoolean, IsNotEmpty, IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTriggerDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsNumber()
  @IsOptional()
  priority?: number;

  @IsString()
  @IsNotEmpty()
  pluginId!: string;

  @IsString()
  @IsNotEmpty()
  pluginVersion!: string;

  @IsJSON()
  @IsOptional()
  config?: string;

  @IsJSON()
  @IsOptional()
  conditions?: string;
}

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsNumber()
  @IsOptional()
  priority?: number;

  @IsString()
  @IsNotEmpty()
  pluginId!: string;

  @IsString()
  @IsNotEmpty()
  pluginVersion!: string;

  @IsJSON()
  @IsOptional()
  params?: string;

  @IsJSON()
  @IsOptional()
  options?: string;
}

export class CreateNotificationChannelDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsJSON()
  @IsOptional()
  config?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class CreateNotificationDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsArray()
  @IsString({ each: true })
  notifyOn!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateNotificationChannelDto)
  channels!: CreateNotificationChannelDto[];

  @IsString()
  @IsOptional()
  templateId?: string;
}

export class CreateAutomationRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsNumber()
  @IsOptional()
  priority?: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  templateId?: string;

  @IsString()
  @IsOptional()
  parentRuleId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTriggerDto)
  triggers!: CreateTriggerDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventDto)
  events!: CreateEventDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateNotificationDto)
  @IsOptional()
  notifications?: CreateNotificationDto[];


}
