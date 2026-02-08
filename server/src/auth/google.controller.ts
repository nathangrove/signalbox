import { Controller, Get, Req, UseGuards, Query, Res, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { AccountsService } from '../accounts/accounts.service';
import { Response } from 'express';

function encodeState(obj: any) {
  return encodeURIComponent(Buffer.from(JSON.stringify(obj)).toString('base64'));
}

function decodeState(s: string) {
  try {
    const raw = Buffer.from(decodeURIComponent(s), 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

@Controller('auth/google')
export class GoogleAuthController {
  constructor(private readonly jwtService: JwtService, private readonly accountsService: AccountsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('url')
  async getAuthUrl(@Req() req: any) {
    const userId = req.user.sub;
    const accountId = req.query.accountId as string | undefined;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const redirect = process.env.GOOGLE_OAUTH_REDIRECT;
    if (!clientId || !redirect) throw new BadRequestException('Google OAuth not configured');

    const state = encodeState({ accountId, token: req.headers.authorization?.replace(/^Bearer\s+/, '') || '' });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email openid',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    if (!code || !state) throw new BadRequestException('Missing code or state');
    const decoded = decodeState(state);
    if (!decoded || !decoded.token) throw new BadRequestException('Invalid state');

    // verify JWT to get user id
    let payload: any;
    try {
      payload = this.jwtService.verify(decoded.token, { ignoreExpiration: true });
    } catch (e) {
      throw new BadRequestException('Invalid user token in state');
    }
    const userId = payload.sub as string;
    const accountId = decoded.accountId as string | undefined;

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirect = process.env.GOOGLE_OAUTH_REDIRECT;
    if (!clientId || !clientSecret || !redirect) throw new BadRequestException('Google OAuth not configured');

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirect,
        grant_type: 'authorization_code'
      }).toString()
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson || !tokenJson.access_token) {
      throw new BadRequestException('Failed to obtain tokens from Google');
    }

    // Fetch userinfo to get the email
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    const userinfo = await userinfoRes.json();
    const email = userinfo?.email || null;

    // Build config to store in encrypted credentials
    const config: any = {
      provider: 'google',
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      user: email,
      oauth: {
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        scope: tokenJson.scope,
        id_token: tokenJson.id_token,
        expires_in: tokenJson.expires_in,
        obtained_at: Date.now()
      }
    };

    if (!accountId) {
      // No account id: create a new account entry for this user
      await this.accountsService.createForUser(userId, { provider: 'google', email: email, config });
    } else {
      await this.accountsService.updateForUser(userId, accountId, { config });
    }

    // Redirect to web UI (if provided) or show a simple success message
    const ui = process.env.FRONTEND_URL || '/';
    return res.redirect(ui + (ui.includes('?') ? '&' : '?') + 'google_oauth=ok');
  }
}
