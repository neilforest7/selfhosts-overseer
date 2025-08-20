import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  command!: string;

  @IsArray()
  @IsString({ each: true })
  targets!: string[];
}