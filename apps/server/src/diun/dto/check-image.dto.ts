import { IsNotEmpty, IsString } from 'class-validator';

export class CheckImageDto {
  @IsString()
  @IsNotEmpty()
  image!: string;
}