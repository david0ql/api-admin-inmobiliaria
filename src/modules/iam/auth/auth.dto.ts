import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'contacto@serrano-inmobiliaria.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class SessionResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ example: '15m', description: 'Vigencia del access token' })
  expiresIn: string | number;
  @ApiProperty() user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    photoUrl: string | null;
    mustSetPassword: boolean;
  };
}
