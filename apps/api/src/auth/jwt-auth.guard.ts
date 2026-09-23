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
      throw new UnauthorizedException({
        code: 'AUTH_MISSING_HEADER',
        message: 'Missing or invalid Authorization header',
      });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_MISSING_TOKEN',
        message: 'Missing JWT',
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Fail-closed: without a configured secret we cannot verify any caller.
      throw new UnauthorizedException({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'JWT secret not configured',
      });
    }

    const options: VerifyOptions = {};
    if (process.env.JWT_ISSUER) {
      options.issuer = process.env.JWT_ISSUER;
    }
    if (process.env.JWT_AUDIENCE) {
      options.audience = process.env.JWT_AUDIENCE;
    }

    let payload: JwtPayload;
    try {
      payload = verify(token, secret, options) as JwtPayload;
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_TOKEN',
        message: 'Invalid JWT',
      });
    }

    const walletAddress =
      payload.walletAddress ??
      payload.wallet ??
      payload.address ??
      payload.sub;

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new UnauthorizedException({
        code: 'AUTH_MISSING_WALLET_CLAIM',
        message: 'JWT is missing wallet address claim',
      });
    }

    // Deny-by-default: only a verified wallet claim is attached to the request.
    req.user = { walletAddress };
    return true;
  }
}
