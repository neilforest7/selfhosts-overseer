import { IsString, IsBoolean, IsOptional, IsInt, Min, IsEnum, IsArray } from 'class-validator';
import { DnsRecordType } from '@prisma/client';

export class CreateDnsRecordDto {
  @IsString()
  domain: string;

  @IsEnum(DnsRecordType)
  recordType: DnsRecordType;

  @IsString()
  providerId: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(60)
  checkInterval?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateDnsRecordDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEnum(DnsRecordType)
  recordType?: DnsRecordType;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(60)
  checkInterval?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
