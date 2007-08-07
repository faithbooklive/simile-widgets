/*==================================================
 *  Exhibit.MapView
 *==================================================
 */

Exhibit.MapView = function(containerElmt, uiContext) {
    this._div = containerElmt;
    this._uiContext = uiContext;

    this._settings = {};
    this._accessors = {
        getProxy:    function(itemID, database, visitor) { visitor(itemID); },
        getColorKey: null,
        getSizeKey: null,
        getIcon:     null
    };
    this._colorCoder = null;
    this._sizeCoder = null;
    
    var view = this;
    this._listener = { 
        onItemsChanged: function() {
            view._reconstruct(); 
        }
    };
    uiContext.getCollection().addListener(this._listener);
};

Exhibit.MapView._settingSpecs = {
    "center":           { type: "float",    defaultValue: [20,0],   dimensions: 2 },
    "zoom":             { type: "float",    defaultValue: 2         },
    "size":             { type: "text",     defaultValue: "small"   },
    "scaleControl":     { type: "boolean",  defaultValue: true      },
    "overviewControl":  { type: "boolean",  defaultValue: false     },
    "type":             { type: "enum",     defaultValue: "normal", choices: [ "normal", "satellite", "hybrid" ] },
    "bubbleTip":        { type: "enum",     defaultValue: "top",    choices: [ "top", "bottom" ] },
    "mapHeight":        { type: "int",      defaultValue: 400       },
    "mapConstructor":   { type: "function", defaultValue: null      },
    "color":            { type: "text",     defaultValue: "#FF9000" },
    "colorCoder":       { type: "text",     defaultValue: null      },
    "sizeCoder":        { type: "text",     defaultValue: null      },
    "iconSize":         { type: "int",      defaultValue: 0         },
    "iconFit":          { type: "text",     defaultValue: "smaller" },
    "iconScale":        { type: "float",    defaultValue: 1         },
    "iconOffsetX":      { type: "float",    defaultValue: 0         },
    "iconOffsetY":      { type: "float",    defaultValue: 0         },
    "shape":            { type: "text",     defaultValue: "circle"  },
    "shapeWidth":       { type: "int",      defaultValue: 24        },
    "shapeHeight":      { type: "int",      defaultValue: 24        },
    "shapeAlpha":       { type: "float",    defaultValue: 0.7       },
    "pin":              { type: "boolean",  defaultValue: true      },
    "pinHeight":        { type: "int",      defaultValue: 6         },
    "pinWidth":         { type: "int",      defaultValue: 6         },
    "sizeLegendLabel":	{ type: "text",     defaultValue: ""        },
    "colorLegendLabel":	{ type: "text",     defaultValue: ""        }
};

Exhibit.MapView._accessorSpecs = [
    {   accessorName:   "getProxy",
        attributeName:  "proxy"
    },
    {   accessorName: "getLatlng",
        alternatives: [
            {   bindings: [
                    {   attributeName:  "latlng",
                        types:          [ "float", "float" ],
                        bindingNames:   [ "lat", "lng" ]
                    },
                    {   attributeName:  "maxAutoZoom",
                        type:           "float",
                        bindingName:    "maxAutoZoom",
                        optional:       true
                    }
                ]
            },
            {   bindings: [
                    {   attributeName:  "lat",
                        type:           "float",
                        bindingName:    "lat"
                    },
                    {   attributeName:  "lng",
                        type:           "float",
                        bindingName:    "lng"
                    },
                    {   attributeName:  "maxAutoZoom",
                        type:           "float",
                        bindingName:    "maxAutoZoom",
                        optional:       true
                    }
                ]
            }
        ]
    },
    {   accessorName:   "getColorKey",
        attributeName:  "marker", // backward compatibility
        type:           "text"
    },
    {   accessorName:   "getColorKey",
        attributeName:  "colorKey",
        type:           "text"
    },
    {   accessorName:   "getSizeKey",
        attributeName:  "sizeKey",
        type:           "text"
    },
    {   accessorName:   "getIcon",
        attributeName:  "icon",
        type:           "url"
    }
];

Exhibit.MapView.create = function(configuration, containerElmt, uiContext) {
    var view = new Exhibit.MapView(
        containerElmt,
        Exhibit.UIContext.create(configuration, uiContext)
    );
    Exhibit.MapView._configure(view, configuration);
    
    view._internalValidate();
    view._initializeUI();
    return view;
};

Exhibit.MapView.createFromDOM = function(configElmt, containerElmt, uiContext) {
    var configuration = Exhibit.getConfigurationFromDOM(configElmt);
    var view = new Exhibit.MapView(
        containerElmt != null ? containerElmt : configElmt, 
        Exhibit.UIContext.createFromDOM(configElmt, uiContext)
    );
    
    Exhibit.SettingsUtilities.createAccessorsFromDOM(configElmt, Exhibit.MapView._accessorSpecs, view._accessors);
    Exhibit.SettingsUtilities.collectSettingsFromDOM(configElmt, Exhibit.MapView._settingSpecs, view._settings);
    Exhibit.MapView._configure(view, configuration);
    
    view._internalValidate();
    view._initializeUI();
    return view;
};

Exhibit.MapView._configure = function(view, configuration) {
    Exhibit.SettingsUtilities.createAccessors(configuration, Exhibit.MapView._accessorSpecs, view._accessors);
    Exhibit.SettingsUtilities.collectSettings(configuration, Exhibit.MapView._settingSpecs, view._settings);
    
    var accessors = view._accessors;
    view._getLatlng = function(itemID, database, visitor) {
        accessors.getProxy(itemID, database, function(proxy) {
            accessors.getLatlng(proxy, database, visitor);
        });
    };
};

Exhibit.MapView.lookupLatLng = function(set, addressExpressionString, outputProperty, outputTextArea, database, accuracy) {
    if (accuracy == undefined) {
        accuracy = 4;
    }
    
    var expression = Exhibit.ExpressionParser.parse(addressExpressionString);
    var jobs = [];
    set.visit(function(item) {
        var address = expression.evaluateSingle(
            { "value" : item },
            { "value" : "item" },
            "value",
            database
        ).value
        if (address != null) {
            jobs.push({ item: item, address: address });
        }
    });
    
    var results = [];
    var geocoder = new GClientGeocoder();
    var cont = function() {
        if (jobs.length > 0) {
            var job = jobs.shift();
            geocoder.getLocations(
                job.address,
                function(json) {
                    if ("Placemark" in json) {
                        json.Placemark.sort(function(p1, p2) {
                            return p2.AddressDetails.Accuracy - p1.AddressDetails.Accuracy;
                        });
                    }
                    
                    if ("Placemark" in json && 
                        json.Placemark.length > 0 && 
                        json.Placemark[0].AddressDetails.Accuracy >= accuracy) {
                        
                        var coords = json.Placemark[0].Point.coordinates;
                        var lat = coords[1];
                        var lng = coords[0];
                        results.push("\t{ id: '" + job.item + "', " + outputProperty + ": '" + lat + "," + lng + "' }");
                    } else {
                        var segments = job.address.split(",");
                        if (segments.length == 1) {
                            results.push("\t{ id: '" + job.item + "' }");
                        } else {
                            job.address = segments.slice(1).join(",").replace(/^\s+/, "");
                            jobs.unshift(job); // do it again
                        }
                    }
                    cont();
                }
            );
        } else {
            outputTextArea.value = results.join(",\n");
        }
    };
    cont();
};

Exhibit.MapView.prototype.dispose = function() {
    this._uiContext.getCollection().removeListener(this._listener);
    
    this._map = null;
    
    this._toolboxWidget.dispose();
    this._toolboxWidget = null;
    
    this._dom.dispose();
    this._dom = null;
    
    this._uiContext.dispose();
    this._uiContext = null;
    
    this._div.innerHTML = "";
    this._div = null;
    
    GUnload();
};

Exhibit.MapView.prototype._internalValidate = function() {
    if ("getColorKey" in this._accessors) {
        if ("colorCoder" in this._settings) {
            this._colorCoder = this._uiContext.getExhibit().getComponent(this._settings.colorCoder);
        }
        
        if (this._colorCoder == null) {
            this._colorCoder = new Exhibit.DefaultColorCoder(this._uiContext);
        }
    }
    if ("getSizeKey" in this._accessors) {  
        if ("sizeCoder" in this._settings) {
            this._sizeCoder = this._uiContext.getExhibit().getComponent(this._settings.sizeCoder);
        }
    }
};

Exhibit.MapView.prototype._initializeUI = function() {
    var self = this;
    var settings = this._settings;
	var legendWidgetSettings = {};
	if ("_gradientPoints" in this._colorCoder) { legendWidgetSettings.colorGradient = true; }	
	legendWidgetSettings.colorMarkerGenerator = function(color) {
		var shape="square";
		return SimileAjax.Graphics.createTranslucentImage(
			Exhibit.MapView._markerUrlPrefix+
			"?renderer=map-marker&shape="+Exhibit.MapView._defaultMarkerShape+
			"&width=20&height=20&pinHeight=5&background="+color.substr(1),
			"middle"
		);
	}
	legendWidgetSettings.sizeMarkerGenerator = function(iconSize) {
		var shape="square";
		return SimileAjax.Graphics.createTranslucentImage(
			Exhibit.MapView._markerUrlPrefix+
			"?renderer=map-marker&shape="+Exhibit.MapView._defaultMarkerShape+
			"&width="+iconSize+
			"&height="+iconSize+
			"&pinHeight=0",
			"middle"
		);
	 }
    
    this._div.innerHTML = "";
    this._dom = Exhibit.ViewUtilities.constructPlottingViewDom(
        this._div, 
        this._uiContext, 
        true, // showSummary
        {   onResize: function() { 
                self._map.checkResize(); 
            } 
        }, 
        legendWidgetSettings
    );    
   
    this._toolboxWidget = Exhibit.ToolboxWidget.createFromDOM(this._div, this._div, this._uiContext);
    
    var mapDiv = this._dom.plotContainer;
    mapDiv.style.height = settings.mapHeight + "px";
    mapDiv.className = "exhibit-mapView-map";
    
    var settings = this._settings;
    if (settings._mapConstructor != null) {
        this._map = settings._mapConstructor(mapDiv);
    } else {
        this._map = new GMap2(mapDiv);
        this._map.enableDoubleClickZoom();
        this._map.enableContinuousZoom();

        this._map.setCenter(new GLatLng(settings.center[0], settings.center[1]), settings.zoom);
        
        this._map.addControl(settings.size == "small" ? new GSmallMapControl() : new GLargeMapControl());
        if (settings.overviewControl) {
            this._map.addControl(new GOverviewMapControl);
        }
        if (settings.scaleControl) {
            this._map.addControl(new GScaleControl());
        }
        
        this._map.addControl(new GMapTypeControl());
        switch (settings.type) {
        case "normal":
            this._map.setMapType(G_NORMAL_MAP);
            break;
        case "satellite":
            this._map.setMapType(G_SATELLITE_MAP);
            break;
        case "hybrid":
            this._map.setMapType(G_HYBRID_MAP);
            break;
        }
    }
    this._reconstruct();
};

Exhibit.MapView.prototype._reconstruct = function() {
    var self = this;
    var collection = this._uiContext.getCollection();
    var database = this._uiContext.getDatabase();
    var settings = this._settings;
    var accessors = this._accessors;	
    /*
     *  Get the current collection and check if it's empty
     */
    var originalSize = collection.countAllItems();
    var currentSize = collection.countRestrictedItems();
    var unplottableItems = [];
    
    this._map.clearOverlays();
	this._dom.legendWidget.clear();
	
    if (currentSize > 0) {
        var currentSet = collection.getRestrictedItems();
        var locationToData = {};
        var hasColorKey = (this._accessors.getColorKey != null);
        var hasSizeKey = (this._accessors.getSizeKey != null);
        var hasIcon = (this._accessors.getIcon != null);
        
        currentSet.visit(function(itemID) {
            var latlngs = [];
            self._getLatlng(itemID, database, function(v) { if ("lat" in v && "lng" in v) latlngs.push(v); });
            
            if (latlngs.length > 0) {
                var colorKeys = null;
                if (hasColorKey) {
                    colorKeys = new Exhibit.Set();
                    accessors.getColorKey(itemID, database, function(v) { colorKeys.add(v); });
                }
                var sizeKeys = null;
                if (hasSizeKey) {
                    sizeKeys = new Exhibit.Set();
                    accessors.getSizeKey(itemID, database, function(v) { sizeKeys.add(v); });
                }
                for (var n = 0; n < latlngs.length; n++) {
                    var latlng = latlngs[n];
                    var latlngKey = latlng.lat + "," + latlng.lng;
                    if (latlngKey in locationToData) {
                        var locationData = locationToData[latlngKey];
                        locationData.items.push(itemID);
                        if (hasColorKey) {
                            locationData.colorKeys.addSet(colorKeys);
                        }
                        if (hasSizeKey) {
                            locationData.sizeKeys.addSet(sizeKeys);
                        }
                    } else {
                        var locationData = {
                            latlng:     latlng,
                            items:      [ itemID ]
                        };
                        if (hasColorKey) {
                            locationData.colorKeys = colorKeys;
                        }
                        if (hasSizeKey) {
                            locationData.sizeKeys = sizeKeys;
                        }
                        locationToData[latlngKey] = locationData;
                    }
                }
            } else {
                unplottableItems.push(itemID);
            }
        });
        
        var colorCodingFlags = { mixed: false, missing: false, others: false, keys: new Exhibit.Set() };
        var sizeCodingFlags = { mixed: false, missing: false, others: false, keys: new Exhibit.Set() };
        var bounds, maxAutoZoom = Infinity;
        var addMarkerAtLocation = function(locationData) {
            var itemCount = locationData.items.length;
            if (!bounds) {
                bounds = new GLatLngBounds();
            }
            
            var shape = self._settings.shape;
            
            var color = self._settings.color;
            if (hasColorKey) {
                color = self._colorCoder.translateSet(locationData.colorKeys, colorCodingFlags);
            }
            var iconSize = self._settings.iconSize;
            if (hasSizeKey) {
            	iconSize = self._sizeCoder.translateSet(locationData.sizeKeys, sizeCodingFlags);
            }

            var icon = null;
            if (itemCount == 1) {
                if (hasIcon) {
                    accessors.getIcon(locationData.items[0], database, function(v) { icon = v; });
                }
            }
            
            var icon = Exhibit.MapView._makeIcon(
                shape, 
                color, 
                iconSize,
                itemCount == 1 ? "" : itemCount.toString(),
                icon,
                self._settings
            );
            
            var point = new GLatLng(locationData.latlng.lat, locationData.latlng.lng);
            var marker = new GMarker(point, icon);
            if (maxAutoZoom > locationData.latlng.maxAutoZoom) {
                maxAutoZoom = locationData.latlng.maxAutoZoom;
            }
            bounds.extend(point);
            
            GEvent.addListener(marker, "click", function() { 
                marker.openInfoWindow(self._createInfoWindow(locationData.items));
            });
            self._map.addOverlay(marker);
        }
        for (var latlngKey in locationToData) {
            addMarkerAtLocation(locationToData[latlngKey]);
        }
        if (hasColorKey) {
            var legendWidget = this._dom.legendWidget;
            var colorCoder = this._colorCoder;
            var keys = colorCodingFlags.keys.toArray().sort();
            if (settings.colorLegendLabel !== "") {
            	legendWidget.addLegendLabel(settings.colorLegendLabel);
            }
			if (colorCoder._gradientPoints != null) {
				var legendGradientWidget = this._dom.legendWidget;
				legendGradientWidget.addGradient(this._colorCoder._gradientPoints);
			} else {
	            for (var k = 0; k < keys.length; k++) {
	                var key = keys[k];
	                var color = colorCoder.translate(key);
	                legendWidget.addEntry(color, key);
	            }
			}
			
			if (colorCodingFlags.others) {
				legendWidget.addEntry(colorCoder.getOthersColor(), colorCoder.getOthersLabel());
			}
			if (colorCodingFlags.mixed) {
				legendWidget.addEntry(colorCoder.getMixedColor(), colorCoder.getMixedLabel());
			}
			if (colorCodingFlags.missing) {
				legendWidget.addEntry(colorCoder.getMissingColor(), colorCoder.getMissingLabel());
			}
		}
		
        if (hasSizeKey) {
            var legendWidget = this._dom.legendWidget;
            sizeLegendDiv = document.createElement('div');
            sizeLegendDiv.setAttribute('align', 'center');
            legendWidget._div = legendWidget._div.parentNode.appendChild(sizeLegendDiv);
            var sizeCoder = this._sizeCoder;
            var keys = sizeCodingFlags.keys.toArray().sort();    
            if (settings.sizeLegendLabel !== "") {
            	legendWidget.addLegendLabel(settings.sizeLegendLabel);
            }
            if (sizeCoder._gradientPoints != null) {
            	var points = sizeCoder._gradientPoints;
            	var space = (points[points.length - 1].value - points[0].value)/10;
            	keys = [];
            	for (var i = 0; i < 11; i++) { keys.push(Math.floor(points[0].value + space*i)); }
            	for (var k = 0; k < keys.length; k++) {
					var key = keys[k];
					var size = sizeCoder.translate(key);
					legendWidget.addEntry(size, key, 'size');
				}
           	} else {       
				for (var k = 0; k < keys.length; k++) {
					var key = keys[k];
					var size = sizeCoder.translate(key);
					legendWidget.addEntry(size, key, 'size');
				}
				if (sizeCodingFlags.others) {
					legendWidget.addEntry(sizeCoder.getOthersSize(), sizeCoder.getOthersLabel(), 'size');
				}
				if (sizeCodingFlags.mixed) {
					legendWidget.addEntry(sizeCoder.getMixedSize(), sizeCoder.getMixedLabel(), 'size');
				}
				if (sizeCodingFlags.missing) {
					legendWidget.addEntry(sizeCoder.getMissingSize(), sizeCoder.getMissingLabel(), 'size');
				}
			}
		}		
        
        if (bounds && typeof settings.zoom == "undefined") {
            var zoom = Math.max(0, self._map.getBoundsZoomLevel(bounds) - 1);
            zoom = Math.min(zoom, maxAutoZoom, settings.maxAutoZoom);
            self._map.setZoom(zoom);
        }
        if (bounds && typeof settings.center == "undefined") {
            self._map.setCenter(bounds.getCenter());
        }
    }
    this._dom.setUnplottableMessage(currentSize, unplottableItems);
};

Exhibit.MapView.prototype._createInfoWindow = function(items) {
    return Exhibit.ViewUtilities.fillBubbleWithItems(
        null, 
        items, 
        this._uiContext
    );
};

Exhibit.MapView._iconData = null;
Exhibit.MapView._markerUrlPrefix = "http://simile.mit.edu/painter/painter?";
Exhibit.MapView._defaultMarkerShape = "circle";

Exhibit.MapView._makeIcon = function(shape, color, iconSize, label, iconURL, settings) {
    var extra = label.length * 3;
    var halfWidth = Math.ceil(settings.shapeWidth / 2) + extra;
    var bodyHeight = settings.shapeHeight;
    var width = halfWidth * 2;
    var height = bodyHeight;
    if (iconSize > 0) {
    	width = iconSize;
    	halfWidth = Math.ceil(iconSize / 2);
    	height = iconSize;
    	bodyHeight = iconSize;
    	settings.pin = false;
    }   
    var icon = new GIcon();
    var imageParameters = [
        "renderer=map-marker",
        "shape=" + shape,
        "alpha=" + settings.shapeAlpha,
        "width=" + width,
        "height=" + bodyHeight,
        "background=" + color.substr(1),
        "label=" + label
    ];
    var shadowParameters = [
        "renderer=map-marker-shadow",
        "shape=" + shape,
        "width=" + width,
        "height=" + bodyHeight
    ];
    var pinParameters = [];
    
    if (iconURL != null) {
        imageParameters.push("icon=" + iconURL);
        if (settings.iconFit != "smaller") {
            imageParameters.push("iconFit=" + settings.iconFit);
        }
        if (settings.iconScale != 1) {
            imageParameters.push("iconScale=" + settings.iconScale);
        }
        if (settings.iconOffsetX != 1) {
            imageParameters.push("iconX=" + settings.iconOffsetX);
        }
        if (settings.iconOffsetY != 1) {
            imageParameters.push("iconY=" + settings.iconOffsetY);
        }
    }
    
    if (settings.pin) {
        var pinHeight = settings.pinHeight;
        var pinHalfWidth = Math.ceil(settings.pinWidth / 2);
        
        height += pinHeight;
        
        pinParameters.push("pinHeight=" + pinHeight);
        pinParameters.push("pinWidth=" + (pinHalfWidth * 2));
        
        icon.iconAnchor = new GPoint(halfWidth, height);
        icon.imageMap = [ 
            0, 0, 
            0, bodyHeight, 
            halfWidth - pinHalfWidth, bodyHeight,
            halfWidth, height,
            halfWidth + pinHalfWidth, bodyHeight,
            width, bodyHeight,
            width, 0
        ];
        icon.shadowSize = new GSize(width * 1.5, height - 2);
        icon.infoWindowAnchor = (settings.bubbleTip == "bottom") ? new GPoint(halfWidth, height) : new GPoint(halfWidth, 0);
    } else {
        pinParameters.push("pin=false");
        
        icon.iconAnchor = new GPoint(halfWidth, Math.ceil(height / 2));
        icon.imageMap = [ 
            0, 0, 
            0, bodyHeight, 
            width, bodyHeight,
            width, 0
        ];
        icon.infoWindowAnchor = new GPoint(halfWidth, 0);
    }
    
    icon.image = Exhibit.MapView._markerUrlPrefix + imageParameters.concat(pinParameters).join("&");
    if (iconSize == 0) { icon.shadow = Exhibit.MapView._markerUrlPrefix + shadowParameters.concat(pinParameters).join("&"); }
    icon.iconSize = new GSize(width, height);
    icon.shadowSize = new GSize(width * 1.5, height - 2);
    
    return icon;
};
