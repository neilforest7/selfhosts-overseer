import { IsNotEmpty, IsNumberString } from 'class-validator';

export class UpdateManualPortDto {
  @IsNumberString()
  @IsNotEmpty()
  exposedPort = '';

  @IsNumberString()
  @IsNotEmpty()
  internalPort = '';
}
