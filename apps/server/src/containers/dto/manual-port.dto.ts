import { IsNotEmpty, IsNumberString } from 'class-validator';

export class UpdateManualPortDto {
  @IsNumberString()
  @IsNotEmpty()
  exposedPort: string;

  @IsNumberString()
  @IsNotEmpty()
  internalPort: string;
}
