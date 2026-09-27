import React from 'react';
import classNames from 'classnames';
import Box from '../box/box.jsx';
import Monitor from '../../containers/monitor.jsx';
import PropTypes from 'prop-types';
import {stageSizeToTransform} from '../../lib/screen-utils';

import styles from './monitor-list.css';

/**
 * Monitors are placed in stage units divided by the UI scale, so that they are as big compared to the stage as on
 * a 480x360 stage however big the reference size of the screen is (scratch-vm engine/screen.js)
 * @param {object} stageSize see getStageDimensions
 * @param {number} uiScale see reducers/screen.js
 * @returns {object} the size of the space the monitors are placed in
 */
const getMonitorSpace = (stageSize, uiScale) => Object.assign({}, stageSize, {
    widthDefault: stageSize.widthDefault / uiScale,
    heightDefault: stageSize.heightDefault / uiScale
});

const MonitorList = props => {
    const space = getMonitorSpace(props.stageSize, props.uiScale || 1);
    return (<Box
        // Use static `monitor-overlay` class for bounds of draggables
        className={classNames(styles.monitorList, 'monitor-overlay', styles.monitorListScaler)}
        style={{
            width: space.widthDefault,
            height: space.heightDefault,
            ...stageSizeToTransform(space)
        }}
    >
        {props.monitors && props.monitors.valueSeq().filter(m => m.visible)
            .map(monitorData => (
                <Monitor
                    draggable={props.draggable}
                    height={monitorData.height}
                    id={monitorData.id}
                    isDiscrete={monitorData.isDiscrete}
                    key={monitorData.id}
                    max={monitorData.sliderMax}
                    min={monitorData.sliderMin}
                    mode={monitorData.mode}
                    opcode={monitorData.opcode}
                    params={monitorData.params}
                    spriteName={monitorData.spriteName}
                    targetId={monitorData.targetId}
                    value={monitorData.value}
                    width={monitorData.width}
                    x={monitorData.x}
                    y={monitorData.y}
                    onDragEnd={props.onMonitorChange}
                />
            ))}
    </Box>);
};

MonitorList.propTypes = {
    draggable: PropTypes.bool.isRequired,
    monitors: PropTypes.shape({
        valueSeq: PropTypes.func
    }),
    onMonitorChange: PropTypes.func.isRequired,
    uiScale: PropTypes.number,
    stageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number,
        widthDefault: PropTypes.number,
        heightDefault: PropTypes.number
    }).isRequired
};

export default MonitorList;
