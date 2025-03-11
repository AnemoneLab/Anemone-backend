import { Request, Response } from 'express';
import { getSkills, addSkill, getSkillById, deleteSkill } from '../db/database';

// 获取所有技能列表
export const getSkillsHandler = async (req: Request, res: Response) => {
    try {
        const skills = await getSkills();
        res.json({
            success: true,
            skills
        });
    } catch (error) {
        console.error('Error fetching skills:', error);
        res.status(500).json({ error: '获取技能列表时出错' });
    }
};

// 添加新技能
export const addSkillHandler = async (req: Request, res: Response) => {
    try {
        const { object_id } = req.body;

        if (!object_id) {
            return res.status(400).json({ error: '缺少必填字段 object_id' });
        }

        const success = await addSkill(object_id);

        if (!success) {
            return res.status(500).json({ error: '添加技能时出错' });
        }
        
        res.json({
            success: true,
            message: '技能添加成功'
        });
    } catch (error) {
        console.error('Error adding skill:', error);
        res.status(500).json({ error: '添加技能时出错' });
    }
};

// 通过ID获取技能
export const getSkillByIdHandler = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({ error: '无效的技能ID' });
        }

        const skill = await getSkillById(id);
        
        if (!skill) {
            return res.status(404).json({ error: '未找到技能' });
        }

        res.json({
            success: true,
            skill
        });
    } catch (error) {
        console.error('Error fetching skill:', error);
        res.status(500).json({ error: '获取技能时出错' });
    }
};

// 删除技能
export const deleteSkillHandler = async (req: Request, res: Response) => {
    try {
        const { object_id } = req.params;
        
        if (!object_id) {
            return res.status(400).json({ error: '缺少必填参数 object_id' });
        }

        const success = await deleteSkill(object_id);
        
        if (!success) {
            return res.status(500).json({ error: '删除技能时出错' });
        }

        res.json({
            success: true,
            message: '技能删除成功'
        });
    } catch (error) {
        console.error('Error deleting skill:', error);
        res.status(500).json({ error: '删除技能时出错' });
    }
}; 