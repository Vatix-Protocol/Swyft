import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verify, VerifyOptions } from 'jsonwebtoken';

interface JwtPayload {
  sub?: string;
  walletAddress?: string;
  wallet?: string;
  address?: string;
  iss?: string;
  aud?: string | string[];
}

interface RequestWithUser {
  headers: { authorization?: string };
  user?: { walletAddress: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing JWT');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException('JWT secret not configured');
    }

    const options: VerifyOptions = {};
    if (process.env.JWT_ISSUER) {
      options.issuer = process.env.JWT_ISSUER;
    }
    if (process.env.JWT_AUDIENCE) {
      options.audience = process.env.JWT_AUDIENCE;
    }

    try {
      const payload = verify(token, secret, options) as JwtPayload;
      const walletAddress =
        payload.walletAddress ??
        payload.wallet ??
        payload.address ??
        payload.sub;

      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new UnauthorizedException('JWT is missing wallet address claim');
      }

      req.user = { walletAddress };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid JWT');
    }
  }
}
