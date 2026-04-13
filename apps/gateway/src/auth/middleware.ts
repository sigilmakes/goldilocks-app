import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '@goldilocks/config';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }
  
  const token = authHeader.slice(7);
  
  try {
    const payload = jwt.verify(token, CONFIG.jwtSecret) as AuthUser;
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email },
    CONFIG.jwtSecret,
    { expiresIn: CONFIG.jwtExpiresIn }
  );
}
