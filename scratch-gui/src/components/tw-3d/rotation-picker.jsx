import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import Dial from '../direction-picker/dial.jsx';

import styles from './sprite-info-3d.css';

/**
 * Each axis is shown as seen from where its rotation is counterclockwise (positive values turn counterclockwise, see
 * the direction conventions in ROADMAP.md). The dial measures clockwise from up, so `offset - angle` puts it on the
 * dial: yaw from above with the front (-z) up, pitch from the right with the front to the right, roll from behind
 * (like the default camera) with up up.
 */
const AXES = [
    {field: 'rotationY', name: 'yaw', axis: 'y', view: '從上面看，上方是前方', offset: 0},
    {field: 'rotationX', name: 'pitch', axis: 'x', view: '從右邊看，右方是前方', offset: 90},
    {field: 'rotationZ', name: 'roll', axis: 'z', view: '從後面看', offset: 0}
];

/**
 * @param {number} degrees any angle
 * @returns {number} same angle in (-180, 180], rounded to whole degrees
 */
const wrap = degrees => {
    const wrapped = Math.round(degrees) % 360;
    if (wrapped > 180) return wrapped - 360;
    if (wrapped <= -180) return wrapped + 360;
    return wrapped;
};

/**
 * Contents of the popover of the rotation inputs of 3D sprites: a dial for one axis, like the direction dial of 2D
 * sprites, and buttons to pick the axis.
 */
class RotationPicker extends React.Component {
    constructor (props) {
        super(props);
        this.handleChangeDial = this.handleChangeDial.bind(this);
        this.handleSelect = {};
        for (const {field} of AXES) {
            this.handleSelect[field] = () => this.props.onSelectAxis(field);
        }
    }
    get axis () {
        return AXES.find(({field}) => field === this.props.axis) || AXES[0];
    }
    handleChangeDial (direction) {
        const {field, offset} = this.axis;
        this.props.onChange(field, wrap(offset - direction));
    }
    render () {
        const {field, offset, view} = this.axis;
        return (
            <div className={styles.rotationPicker}>
                <div className={styles.rotationAxes}>
                    {AXES.map(({field: axisField, name, axis}) => (
                        <button
                            key={axisField}
                            className={classNames(styles.rotationAxis, {
                                [styles.rotationAxisSelected]: axisField === field
                            })}
                            onClick={this.handleSelect[axisField]}
                        >
                            <span className={styles[`axis${axis.toUpperCase()}`]}>{axis}</span>
                            {` ${name}`}
                        </button>
                    ))}
                </div>
                <Dial
                    direction={offset - (this.props[field] || 0)}
                    radius={48}
                    showGauge={offset === 0}
                    onChange={this.handleChangeDial}
                />
                <div className={styles.rotationView}>{view}</div>
            </div>
        );
    }
}

RotationPicker.propTypes = {
    axis: PropTypes.oneOf(AXES.map(({field}) => field)),
    onChange: PropTypes.func.isRequired,
    onSelectAxis: PropTypes.func.isRequired,
    /* eslint-disable react/no-unused-prop-types */
    rotationX: PropTypes.number,
    rotationY: PropTypes.number,
    rotationZ: PropTypes.number
    /* eslint-enable react/no-unused-prop-types */
};

export default RotationPicker;
