import { Request, Response } from 'express';

/**
 * Handle chat messages
 * @param req - Express request object
 * @param res - Express response object
 */
export const chatHandler = async (req: Request, res: Response) => {
    try {
        // 获取请求体中的消息内容和roleId
        const { message, roleId } = req.body;
        
        // 打印接收到的消息
        console.log(`[Chat] Received message from roleId ${roleId}: ${message}`);
        
        // 目前返回固定内容
        const response = {
            text: `我收到了你的消息: "${message}"。这是一个固定回复。`,
            roleId: roleId
        };
        
        // 返回响应
        return res.status(200).json({ 
            success: true, 
            response 
        });
    } catch (error) {
        console.error('[Chat] Error processing chat message:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
} 