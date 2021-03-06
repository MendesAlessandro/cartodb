var Backbone = require('backbone');
var _ = require('underscore');
var syncAbort = require('./backbone/sync-abort');
var StyleDefinitionModel = require('../editor/style/style-definition-model');
var StyleCartoCSSModel = require('../editor/style/style-cartocss-model');
var DataSQLModel = require('../editor/layers/layer-content-views/data/data-sql-model');
var layerTypesAndKinds = require('./layer-types-and-kinds');
var InfowindowModel = require('./infowindow-click-model');
var TooltipModel = require('./infowindow-hover-model');
var TableNameUtils = require('../helpers/table-name-utils');

// from_layer_id and from_letter are not attributes for the model, but are sent to the layer creation
// endpoint when creating a layer from an existing analysis node (see user-actions)
var OWN_ATTR_NAMES = ['id', 'order', 'infowindow', 'tooltip', 'error', 'from_layer_id', 'from_letter'];

/**
 * Model to edit a layer definition.
 * Should always exist as part of a LayerDefinitionsCollection, so its URL is given from there.
 */
module.exports = Backbone.Model.extend({

  /**
   * @override {Backbone.prototype.sync} abort ongoing request if there is any
   */
  sync: syncAbort,

  parse: function (r, opts) {
    r.options = r.options || {};

    // Flatten the attrs, to avoid having this.get('options').foobar internally
    var attrs = _
      .defaults(
        _.pick(r, OWN_ATTR_NAMES),
        _.omit(r.options, ['query', 'tile_style'])
    );

    // Only use type on the frontend, it will be mapped back when the model is serialized (see .toJSON)
    attrs.type = attrs.type || layerTypesAndKinds.getType(r.kind);

    // Map API endpoint attrs to the new names used client-side (cartodb.js in particular)
    if (r.options.tile_style) {
      attrs.cartocss = r.options.tile_style;
    }
    if (r.options.query) {
      attrs.sql = r.options.query;
    }

    if (r.infowindow) {
      if (!this.infowindowModel) {
        this.infowindowModel = new InfowindowModel(r.infowindow, {
          configModel: opts.configModel || this._configModel
        });
      }
    }
    if (r.tooltip) {
      if (!this.tooltipModel) {
        this.tooltipModel = new TooltipModel(r.tooltip, {
          configModel: opts.configModel || this._configModel
        });
      }
    }
    if (r.options.table_name) {
      // Set autostyle as false if it doesn't contain any id
      attrs.autoStyle = attrs.autoStyle || false;

      if (!this.styleModel) {
        this.styleModel = new StyleDefinitionModel(r.options.style_properties, {
          parse: true
        });

        this.cartocssModel = new StyleCartoCSSModel({
          content: attrs.cartocss
        }, {
          history: r.options.cartocss_history || r.options.tile_style_history
        });
      }

      if (!this.sqlModel) {
        this.sqlModel = new DataSQLModel({
          content: attrs.sql
        }, {
          history: r.options.sql_history
        });
      }
    }

    // Flatten the rest of the attributes
    return attrs;
  },

  initialize: function (attrs, opts) {
    if (!opts.configModel) throw new Error('configModel is required');

    this._configModel = opts.configModel;

    this.on('change:source change:sql', this._onPosibleLayerSchemaChanged, this);

    if (this.styleModel) {
      this.styleModel.bind('change:type change:animated', function () {
        if (this.styleModel.isAggregatedType() || this.styleModel.isAnimation()) {
          // setTemplate will clear fields
          this.infowindowModel && this.infowindowModel.unsetTemplate();
          this.tooltipModel && this.tooltipModel.unsetTemplate();
        }
      }, this);
    }
  },

  save: function (attrs, options) {
    // We assume that if the layer is saved, we have to disable autostyle
    var autoStyleAttrs = {
      autoStyle: false
    };

    // But if the layer is saved with shouldPreserveAutoStyle option, we should preserve autostyle
    if (options && options.shouldPreserveAutoStyle) {
      delete autoStyleAttrs.autoStyle;
    } else if (this.get('autoStyle')) {
      this.styleModel && this.styleModel.resetPropertiesFromAutoStyle();
    }

    attrs = _.extend(
      {},
      autoStyleAttrs,
      attrs
    );

    return Backbone.Model.prototype.save.apply(this, [attrs, options]);
  },

  toJSON: function () {
    // Un-flatten the internal attrs to the datastructure that's expected by the API endpoint
    var options = _.omit(this.attributes, OWN_ATTR_NAMES.concat(['cartocss', 'sql', 'autoStyle']));

    // Map back internal attrs to the expected attrs names by the API endpoint
    var cartocss = this.get('cartocss');

    if (cartocss) {
      options.tile_style = cartocss;
    }
    var sql = this.get('sql');
    if (sql) {
      options.query = sql;
    }

    var d = {
      kind: layerTypesAndKinds.getKind(this.get('type')),
      options: options
    };

    var infowindowData = this.infowindowModel && this.infowindowModel.toJSON();
    if (!_.isEmpty(infowindowData)) {
      d.infowindow = this.infowindowModel.toJSON();
    }

    var tooltipData = this.tooltipModel && this.tooltipModel.toJSON();
    if (!_.isEmpty(tooltipData)) {
      d.tooltip = this.tooltipModel.toJSON();
    }

    if (this.styleModel && !this.styleModel.isAutogenerated()) {
      d.options.style_properties = this.styleModel.toJSON();
    }

    if (this.cartocssModel) {
      d.options.cartocss_history = this.cartocssModel.getHistory();
    }

    if (this.sqlModel) {
      d.options.sql_history = this.sqlModel.getHistory();
    }

    var attributes = _.omit(this.attributes, 'infowindow', 'tooltip', 'options', 'error', 'autoStyle');

    return _.defaults(
      d,
      _.pick(attributes, OWN_ATTR_NAMES)
    );
  },

  canBeDeletedByUser: function () {
    return this.collection.getNumberOfDataLayers() > 1 && this.isDataLayer() &&
      (this._canBeFoldedUnderAnotherLayer() || !this._isAllDataLayersDependingOnAnyAnalysisOfThisLayer());
  },

  isOwnerOfAnalysisNode: function (nodeModel) {
    return nodeModel && nodeModel.letter() === this.get('letter');
  },

  ownedPrimaryAnalysisNodes: function () {
    var nodeDefModel = this.getAnalysisDefinitionNodeModel();
    return this.isOwnerOfAnalysisNode(nodeDefModel)
      ? nodeDefModel.linkedListBySameLetter()
      : [];
  },

  getName: function () {
    return this.get('name') ||
    this.get('table_name_alias') ||
    this.get('table_name');
  },

  getTableName: function () {
    return this.get('table_name') || '';
  },

  containsNode: function (other) {
    var nodeDefModel = this.getAnalysisDefinitionNodeModel();
    return nodeDefModel && nodeDefModel.containsNode(other);
  },

  getAnalysisDefinitionNodeModel: function () {
    return this.findAnalysisDefinitionNodeModel(this.get('source'));
  },

  findAnalysisDefinitionNodeModel: function (id) {
    return this.collection && this.collection.findAnalysisDefinitionNodeModel(id);
  },

  _onPosibleLayerSchemaChanged: function (eventName, attrs, options) {
    // Used to avoid resetting styles on source_id changes when we have saved styles for the node
    if (options && options.ignoreSchemaChange) {
      return;
    }

    if (this.infowindowModel) {
      this.infowindowModel.clearFields();
    }
    if (this.tooltipModel) {
      this.tooltipModel.clearFields();
    }
    if (this.styleModel) {
      this.styleModel.resetStyles();
    }
  },

  toggleVisible: function () {
    this.set('visible', !this.get('visible'));
  },

  hasAnalyses: function () {
    return this.getNumberOfAnalyses() > 0;
  },

  getNumberOfAnalyses: function () {
    var analysisNode = this.getAnalysisDefinitionNodeModel();
    var count = 0;
    while (analysisNode && this.isOwnerOfAnalysisNode(analysisNode)) {
      analysisNode = analysisNode.getPrimarySource();

      if (analysisNode) {
        count += 1;
      }
    }
    return count;
  },

  getQualifiedTableName: function () {
    var userName = this.get('user_name') || this.collection.userModel.get('username');
    return TableNameUtils.getQualifiedTableName(
      this.getTableName(),
      userName,
      this.collection.userModel.isInsideOrg()
    );
  },

  getColumnNamesFromSchema: function () {
    return this._getQuerySchemaModel().getColumnNames();
  },

  _getQuerySchemaModel: function () {
    var nodeDefModel = this.getAnalysisDefinitionNodeModel();
    return nodeDefModel.querySchemaModel;
  },

  isDataLayer: function () {
    var layerType = this.get('type');
    return layerTypesAndKinds.isCartoDBType(layerType) ||
      layerTypesAndKinds.isTorqueType(layerType);
  },

  isTorqueLayer: function () {
    return this.get('type') === 'torque';
  },

  _canBeFoldedUnderAnotherLayer: function () {
    var thisNodeDefModel = this.getAnalysisDefinitionNodeModel();

    return this.collection.any(function (m) {
      if (m !== this && m.isDataLayer()) {
        var otherNodeDefModel = m.getAnalysisDefinitionNodeModel();
        if (otherNodeDefModel === thisNodeDefModel) return true;

        var lastNode = _.last(otherNodeDefModel.linkedListBySameLetter());
        return lastNode.getPrimarySource() === thisNodeDefModel;
      }
    }, this);
  },

  _isAllDataLayersDependingOnAnyAnalysisOfThisLayer: function () {
    var nodeDefModel = this.getAnalysisDefinitionNodeModel();
    if (!nodeDefModel) return false;
    if (!this.isOwnerOfAnalysisNode(nodeDefModel)) return false;

    var linkedNodesList = nodeDefModel.linkedListBySameLetter();

    return this.collection.chain()
      .filter(function (m) {
        return m !== this && !!m.get('source');
      }, this)
      .all(function (m) {
        return _.any(linkedNodesList, function (node) {
          return m.containsNode(node);
        });
      }, this)
      .value();
  },

  getAllDependentLayers: function () {
    var self = this;
    var layersCount = 0;

    var layerDefinitionsCollectionModels = self.collection.models;

    for (var i = 0; i < layerDefinitionsCollectionModels.length; i++) {
      var layer = layerDefinitionsCollectionModels[i];
      var dependentAnalysis = false;

      if (layer !== self) {
        var analysisNode = layer.getAnalysisDefinitionNodeModel();

        while (analysisNode) {
          if (self.isOwnerOfAnalysisNode(analysisNode)) {
            dependentAnalysis = true;
          }
          analysisNode = analysisNode.getPrimarySource();
        }

        if (dependentAnalysis) {
          layersCount += 1;
        }
      }
    }
    return layersCount;
  },

  matchesAttrs: function (otherAttrs) {
    if (this.get('type') !== otherAttrs.type) {
      return false;
    }

    if (layerTypesAndKinds.isTiledType(otherAttrs.type)) {
      return this.get('name') === otherAttrs.name &&
        this.get('urlTemplate') === otherAttrs.urlTemplate;
    }

    if (layerTypesAndKinds.isGMapsBase(otherAttrs.type)) {
      return this.get('name') === otherAttrs.name &&
        this.get('baseType') === otherAttrs.baseType &&
          this.get('style') === otherAttrs.style;
    }

    if (layerTypesAndKinds.isPlainType(otherAttrs.type)) {
      return this.get('color') === otherAttrs.color;
    }

    return false;
  }
});
