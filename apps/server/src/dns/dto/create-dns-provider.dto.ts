import { IsString, IsBoolean, IsOptional, IsInt, Min, Max, IsObject } from 'class-validator';

export class CreateDnsProviderDto {
  @IsString()
  name!: string;

  @IsString()
  displayName!: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsObject()
  apiConfig!: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitPerMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  timeoutSeconds?: number;
}
