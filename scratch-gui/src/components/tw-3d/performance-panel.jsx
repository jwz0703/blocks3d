import PropTypes from 'prop-types';
import React from 'react';

import styles from './stage-3d-toolbar.css';

// How often the numbers change, in milliseconds
const UPDATE_INTERVAL = 500;

const formatNumber = number => {
    if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
    if (number >= 1e4) return `${(number / 1e3).toFixed(1)}k`;
    return String(number);
};

/* eslint-disable react/jsx-no-literals */
/**
 * FPS and what the 3D scene drew last time, from three.js renderer.info (ROADMAP.md 7.4). Over the top right of the
 * stage, turned on in the 3D toolbar.
 */
class PerformancePanel extends React.Component {
    constructor (props) {
        super(props);
        this.update = this.update.bind(this);
        this.state = props.scene3D.getStats();
    }
    componentDidMount () {
        this.interval = setInterval(this.update, UPDATE_INTERVAL);
    }
    componentWillUnmount () {
        clearInterval(this.interval);
    }
    update () {
        this.setState(this.props.scene3D.getStats());
    }
    renderRow (label, value, title) {
        return (
            <div
                className={styles.statsRow}
                title={title}
            >
                <span className={styles.statsLabel}>{label}</span>
                <span className={styles.statsValue}>{value}</span>
            </div>
        );
    }
    render () {
        const stats = this.state;
        return (
            <div className={styles.stats}>
                {this.renderRow('FPS', stats.fps || '–', '執行中的每秒幀數；專案沒有在跑幀時是 –')}
                {this.renderRow('繪製次數', formatNumber(stats.drawCalls), '上一次畫 3D 場景用了幾次 draw call')}
                {this.renderRow('三角形', formatNumber(stats.triangles))}
                {this.renderRow(
                    '角色 / 分身',
                    `${stats.sprites} / ${stats.clones}`,
                    '3D 角色和它們的分身，不含相機'
                )}
                {stats.objects ? this.renderRow('程序物件', stats.objects) : null}
                {this.renderRow(
                    '合併繪製',
                    stats.batches ? `${stats.instanced}（${stats.batches} 組）` : '–',
                    '形狀和材質相同的物件（例如分身）自動合併成一次繪製'
                )}
                {stats.culled ? this.renderRow('畫面外略過', stats.culled) : null}
                {this.renderRow('幾何 / 貼圖', `${stats.geometries} / ${stats.textures}`, 'GPU 上的幾何和貼圖數量')}
                {this.renderRow('陰影', stats.shadows ? '開' : '關')}
            </div>
        );
    }
}
/* eslint-enable react/jsx-no-literals */

PerformancePanel.propTypes = {
    scene3D: PropTypes.shape({
        getStats: PropTypes.func.isRequired
    }).isRequired
};

export default PerformancePanel;
