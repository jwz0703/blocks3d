import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import get3DThumbnail from '../../lib/tw-3d-thumbnail';

/**
 * Image of a 3D model, rendered offscreen.
 */
class ModelThumbnail extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            url: null
        };
    }
    componentDidMount () {
        this.update();
    }
    componentDidUpdate (prevProps) {
        if (this.key(prevProps) !== this.key(this.props)) {
            this.update();
        }
    }
    componentWillUnmount () {
        this.unmounted = true;
    }
    key (props) {
        return JSON.stringify([props.model, props.material, props.fileVersion]);
    }
    update () {
        const key = this.key(this.props);
        get3DThumbnail(this.props.vm, this.props.model, this.props.material).then(url => {
            if (this.unmounted || this.key(this.props) !== key) return;
            this.setState({url});
        });
    }
    render () {
        if (!this.state.url) {
            return <div className={this.props.className} />;
        }
        return (
            <img
                className={this.props.className}
                src={this.state.url}
                alt=""
                draggable={false}
            />
        );
    }
}

ModelThumbnail.propTypes = {
    className: PropTypes.string,
    // Changes when the model's file might have changed
    fileVersion: PropTypes.number, // eslint-disable-line react/no-unused-prop-types
    material: PropTypes.shape({
        color: PropTypes.string,
        opacity: PropTypes.number,
        texture: PropTypes.string
    }),
    model: PropTypes.shape({
        name: PropTypes.string,
        shape: PropTypes.string,
        file: PropTypes.string
    }).isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default ModelThumbnail;
