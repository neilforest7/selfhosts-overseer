import { IsString, IsOptional, IsInt, IsNotEmpty } from 'class-validator';

export class CreateHostDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsInt()
  @IsOptional()
  port?: number;

  @IsString()
  @IsNotEmpty()
  sshUser!: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  privateKey?: string;

  @IsString()
  @IsOptional()
  privateKeyPassphrase?: string;
}