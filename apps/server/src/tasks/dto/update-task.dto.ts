import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  command?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targets?: string[];
}
