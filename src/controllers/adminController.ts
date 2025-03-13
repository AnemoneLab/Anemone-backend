import { Request, Response } from 'express';
import { getQuery, updatePhalaAccount, runQuery } from '../db/database';

/**
 * Update Phala account API key
 * @param req Request with account_id and api_key parameters
 * @param res Response
 */
export const updateApiKeyHandler = async (req: Request, res: Response) => {
  try {
    const { account_id, api_key } = req.body;
    
    if (!account_id || !api_key) {
      return res.status(400).json({ 
        success: false, 
        message: 'Account ID and API key are required' 
      });
    }
    
    // 查询账户是否存在
    const accounts = await getQuery('SELECT * FROM phala_accounts WHERE id = ?', [account_id]);
    
    if (accounts.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Account not found' 
      });
    }
    
    // 更新API Key
    const result = await updatePhalaAccount(account_id, {
      api_key
    });
    
    if (!result) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update API key' 
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'API key updated successfully'
    });
    
  } catch (error: any) {
    console.error('Error updating API key:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to update API key' 
    });
  }
};

/**
 * List all Phala accounts
 * @param req Request
 * @param res Response
 */
export const listPhalaAccountsHandler = async (req: Request, res: Response) => {
  try {
    // 获取所有Phala账户信息，但不返回密码
    const accounts = await getQuery(`
      SELECT id, username, api_key, app_id, cvm_endpoint, cvm_address, status, created_at, updated_at
      FROM phala_accounts
      ORDER BY id ASC
    `);
    
    return res.status(200).json({
      success: true,
      accounts
    });
    
  } catch (error: any) {
    console.error('Error listing Phala accounts:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to list Phala accounts' 
    });
  }
};

/**
 * Create a new Phala account
 * @param req Request with username and password parameters
 * @param res Response
 */
export const createPhalaAccountHandler = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }
    
    // 检查用户名是否已存在
    const existingAccounts = await getQuery('SELECT * FROM phala_accounts WHERE username = ?', [username]);
    
    if (existingAccounts.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'Username already exists' 
      });
    }
    
    // 创建新账户
    const result = await runQuery(
      'INSERT INTO phala_accounts (username, password, status) VALUES (?, ?, ?)',
      [username, password, 'ready']
    );
    
    if (!result) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create Phala account' 
      });
    }
    
    return res.status(201).json({
      success: true,
      message: 'Phala account created successfully',
      account_id: (result as any).lastID
    });
    
  } catch (error: any) {
    console.error('Error creating Phala account:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create Phala account' 
    });
  }
}; 