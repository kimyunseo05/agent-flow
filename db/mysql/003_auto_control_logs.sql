-- 자동 제어 로그 테이블
-- 모델의 자동 제어 ON/OFF 상태 변경 기록

CREATE TABLE IF NOT EXISTS auto_control_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    model_unit_id INT NOT NULL,
    old_status VARCHAR(10) NOT NULL,        -- 변경 전 상태 (ON/OFF)
    new_status VARCHAR(10) NOT NULL,        -- 변경 후 상태 (ON/OFF)
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- 외래 키 제약조건
    CONSTRAINT fk_auto_control_model_unit FOREIGN KEY (model_unit_id) REFERENCES model_units(id) ON DELETE CASCADE
);

-- 인덱스 생성 (조회 성능 최적화)
CREATE INDEX IF NOT EXISTS idx_auto_control_model_unit ON auto_control_logs(model_unit_id);
CREATE INDEX IF NOT EXISTS idx_auto_control_created_at ON auto_control_logs(created_at DESC);
